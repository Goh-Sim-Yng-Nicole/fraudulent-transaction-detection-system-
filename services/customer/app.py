from __future__ import annotations

import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from services.customer.auth import (
    create_access_token,
    decode_access_token,
    generate_otp_code,
    hash_password,
    send_otp_email,
    verify_password,
)
from services.customer.db import (
    create_engine,
    create_sessionmaker,
    init_db,
    should_auto_create_tables,
    wait_for_db,
)
from services.customer.models import Customer, OtpCode

OTP_EXPIRY_MINUTES = 10


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CustomerRegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: str  # required — must include country code e.g. +6591234567

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v

    @field_validator("phone")
    @classmethod
    def phone_must_have_code(cls, v: str) -> str:
        normalized = re.sub(r"[\s\-\(\)]", "", v)
        if not normalized.startswith("+") or len(normalized) < 8:
            raise ValueError("phone must include country code e.g. +6591234567")
        return normalized


class CustomerLoginRequest(BaseModel):
    email: EmailStr
    password: str


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp_code: str


class ResendOtpRequest(BaseModel):
    email: EmailStr


class CustomerResponse(BaseModel):
    customer_id: str
    email: str
    full_name: str
    phone: str | None
    is_active: bool
    created_at: Any
    updated_at: Any

    model_config = {"from_attributes": True}

    @field_validator("customer_id", mode="before")
    @classmethod
    def coerce_uuid_to_str(cls, v: Any) -> str:
        return str(v)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    customer: CustomerResponse


class CustomerUpdateRequest(BaseModel):
    full_name: str | None = None
    phone: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    otp_code: str

    @field_validator("new_password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("new password must be at least 8 characters")
        return v


class DeleteAccountRequest(BaseModel):
    password: str
    otp_code: str


# ── App state ─────────────────────────────────────────────────────────────────

class AppState:
    engine: AsyncEngine | None = None
    session_factory: async_sessionmaker[AsyncSession] | None = None


_state = AppState()


@asynccontextmanager
async def lifespan(app: FastAPI):
    database_url = os.getenv("DATABASE_URL", "").strip()
    _state.engine = create_engine(database_url)
    await wait_for_db(_state.engine)
    if should_auto_create_tables():
        await init_db(_state.engine)
    _state.session_factory = create_sessionmaker(_state.engine)
    try:
        yield
    finally:
        if _state.engine is not None:
            await _state.engine.dispose()


app = FastAPI(title="FTDS Customer Service", version="0.2.0", lifespan=lifespan)


# ── Dependencies ──────────────────────────────────────────────────────────────

security = HTTPBearer()


async def get_db() -> AsyncSession:  # type: ignore[return]
    assert _state.session_factory is not None
    async with _state.session_factory() as session:
        yield session


async def get_current_customer(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> Customer:
    try:
        customer_id = decode_access_token(credentials.credentials)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    result = await db.execute(
        select(Customer).where(Customer.customer_id == uuid.UUID(customer_id))
    )
    customer = result.scalar_one_or_none()
    if customer is None or not customer.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Customer not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return customer


# ── OTP helpers ───────────────────────────────────────────────────────────────

async def _create_and_send_otp(customer: Customer, db: AsyncSession, purpose: str = "login") -> None:
    """Invalidate previous OTPs, create a new one, and email it."""
    # Mark previous unused OTPs for this customer as used
    prev = await db.execute(
        select(OtpCode).where(
            OtpCode.customer_id == str(customer.customer_id),
            OtpCode.used == False,  # noqa: E712
        )
    )
    for old in prev.scalars().all():
        old.used = True

    code = generate_otp_code()
    otp = OtpCode(
        customer_id=str(customer.customer_id),
        code=code,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES),
        used=False,
    )
    db.add(otp)
    await db.commit()
    await send_otp_email(customer.email, customer.full_name, code, purpose=purpose)


async def _verify_otp(customer_id: str, code: str, db: AsyncSession) -> bool:
    """Returns True if OTP is valid and unexpired; marks it as used."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(OtpCode).where(
            OtpCode.customer_id == customer_id,
            OtpCode.code == code,
            OtpCode.used == False,  # noqa: E712
            OtpCode.expires_at > now,
        )
    )
    otp = result.scalar_one_or_none()
    if otp is None:
        return False
    otp.used = True
    await db.commit()
    return True


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready() -> dict[str, str]:
    return {"status": "ok"}


# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: CustomerRegisterRequest, db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(select(Customer).where(Customer.email == payload.email))
    customer = result.scalar_one_or_none()

    if customer is not None:
        if customer.is_active:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
        # Reactivate soft-deleted account with fresh details
        customer.full_name = payload.full_name
        customer.phone = payload.phone
        customer.password_hash = hash_password(payload.password)
        customer.is_active = True
    else:
        customer = Customer(
            customer_id=uuid.uuid4(),
            email=payload.email,
            password_hash=hash_password(payload.password),
            full_name=payload.full_name,
            phone=payload.phone,
        )
        db.add(customer)

    await db.commit()
    await db.refresh(customer)

    token = create_access_token(str(customer.customer_id))
    return TokenResponse(access_token=token, customer=CustomerResponse.model_validate(customer))


@app.post("/login")
async def login(payload: CustomerLoginRequest, db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(select(Customer).where(Customer.email == payload.email))
    customer = result.scalar_one_or_none()

    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account does not exist")
    if not verify_password(payload.password, customer.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
    if not customer.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    # Send OTP — customer must verify before receiving JWT
    await _create_and_send_otp(customer, db, purpose="login")
    return {"requires_otp": True, "message": f"Verification code sent to {customer.email}"}


@app.post("/verify-otp", response_model=TokenResponse)
async def verify_otp(payload: VerifyOtpRequest, db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(select(Customer).where(Customer.email == payload.email))
    customer = result.scalar_one_or_none()
    if customer is None or not customer.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid request")

    valid = await _verify_otp(str(customer.customer_id), payload.otp_code, db)
    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP")

    token = create_access_token(str(customer.customer_id))
    return TokenResponse(access_token=token, customer=CustomerResponse.model_validate(customer))


@app.post("/resend-otp")
async def resend_otp(payload: ResendOtpRequest, db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(select(Customer).where(Customer.email == payload.email))
    customer = result.scalar_one_or_none()
    if customer is None or not customer.is_active:
        # Return same message to avoid email enumeration
        return {"message": "If this email exists, a new code has been sent"}
    await _create_and_send_otp(customer, db, purpose="login")
    return {"message": f"New verification code sent to {customer.email}"}


# ─── Profile CRUD ─────────────────────────────────────────────────────────────

@app.get("/lookup")
async def lookup_customer(
    query: str = Query(..., description="Email address or phone number (with country code)"),
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Look up an FTDS customer by email or phone number. JWT required."""
    query = query.strip()
    if "@" in query:
        stmt = select(Customer).where(Customer.email == query, Customer.is_active == True)  # noqa: E712
    else:
        normalized = re.sub(r"[\s\-\(\)]", "", query)
        stmt = select(Customer).where(Customer.phone == normalized, Customer.is_active == True)  # noqa: E712
    result = await db.execute(stmt)
    found = result.scalar_one_or_none()
    if found is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    if str(found.customer_id) == str(current.customer_id):
        raise HTTPException(status_code=400, detail="Cannot transfer to yourself")
    return {"customer_id": str(found.customer_id), "full_name": found.full_name, "email": found.email}


@app.get("/internal/contact/{customer_id}")
async def internal_get_contact(customer_id: str, db: AsyncSession = Depends(get_db)) -> Any:
    """Internal endpoint (no auth) — used by other services to get recipient contact details."""
    try:
        uid = uuid.UUID(customer_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid customer_id")
    result = await db.execute(select(Customer).where(Customer.customer_id == uid, Customer.is_active == True))  # noqa: E712
    c = result.scalar_one_or_none()
    if c is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return {"customer_id": str(c.customer_id), "full_name": c.full_name, "email": c.email, "phone": c.phone}


@app.get("/me", response_model=CustomerResponse)
async def get_me(current: Customer = Depends(get_current_customer)) -> Any:
    return CustomerResponse.model_validate(current)


@app.put("/me", response_model=CustomerResponse)
async def update_me(
    payload: CustomerUpdateRequest,
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    if payload.full_name is not None:
        current.full_name = payload.full_name
    if payload.phone is not None:
        current.phone = payload.phone
    db.add(current)
    await db.commit()
    await db.refresh(current)
    return CustomerResponse.model_validate(current)


@app.put("/me/password")
async def change_password(
    payload: ChangePasswordRequest,
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    if not verify_password(payload.current_password, current.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    valid = await _verify_otp(str(current.customer_id), payload.otp_code, db)
    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP")

    current.password_hash = hash_password(payload.new_password)
    db.add(current)
    await db.commit()
    return {"message": "Password changed successfully"}


@app.post("/me/request-otp")
async def request_sensitive_otp(
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """Request an OTP for sensitive operations (change password, delete account)."""
    await _create_and_send_otp(current, db, purpose="change_password")
    return {"message": f"Verification code sent to {current.email}"}


@app.delete("/me")
async def delete_account(
    payload: DeleteAccountRequest,
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    if not verify_password(payload.password, current.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect password")

    valid = await _verify_otp(str(current.customer_id), payload.otp_code, db)
    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP")

    current.is_active = False   # soft delete — data is retained for audit
    db.add(current)
    await db.commit()
    return {"message": "Account deleted successfully"}
