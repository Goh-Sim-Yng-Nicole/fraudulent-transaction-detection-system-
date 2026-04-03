from __future__ import annotations

import base64
import os
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
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
from services.customer.observability import (
    instrument_fastapi,
    instrument_sqlalchemy,
    shutdown_tracing,
)

OTP_EXPIRY_MINUTES = 10
OAUTH_STATE_TTL_SECONDS = 600
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
_oauth_state_store: dict[str, dict[str, Any]] = {}


class CustomerRegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("password must be at least 8 characters")
        return value

    @field_validator("phone")
    @classmethod
    def phone_must_have_code(cls, value: str) -> str:
        normalized = re.sub(r"[\s\-\(\)]", "", value)
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
    def coerce_uuid_to_str(cls, value: Any) -> str:
        return str(value)


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
    def password_min_length(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("new password must be at least 8 characters")
        return value


class DeleteAccountRequest(BaseModel):
    password: str
    otp_code: str


class AppState:
    engine: AsyncEngine | None = None
    session_factory: async_sessionmaker[AsyncSession] | None = None


_state = AppState()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    database_url = os.getenv("DATABASE_URL", "").strip()
    _state.engine = create_engine(database_url)
    instrument_sqlalchemy(_state.engine)
    await wait_for_db(_state.engine)
    if should_auto_create_tables():
        await init_db(_state.engine)
    _state.session_factory = create_sessionmaker(_state.engine)
    try:
        yield
    finally:
        if _state.engine is not None:
            await _state.engine.dispose()
        shutdown_tracing()


app = FastAPI(title="FTDS Customer Service", version="0.3.0", lifespan=lifespan)
instrument_fastapi(app)
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
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    result = await db.execute(select(Customer).where(Customer.customer_id == uuid.UUID(customer_id)))
    customer = result.scalar_one_or_none()
    if customer is None or not customer.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Customer not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return customer


async def _create_and_send_otp(customer: Customer, db: AsyncSession, purpose: str = "login") -> None:
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


def _base64url_encode(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("utf-8").rstrip("=")


def _safe_next_path(next_path: str) -> str:
    normalized = str(next_path or "").strip() or "/banking"
    if not normalized.startswith("/") or normalized.startswith("//"):
        return "/banking"
    return normalized


def _public_base_url(request: Request) -> str:
    configured = (os.getenv("PUBLIC_BASE_URL", "").strip() or os.getenv("HTTPS_BASE_URL", "").strip())
    if configured:
        return configured.rstrip("/")

    host = request.headers.get("host", "").strip() or "localhost:8088"
    scheme = request.headers.get("x-forwarded-proto", "").strip() or request.url.scheme
    return f"{scheme}://{host}".rstrip("/")


def _oauth_error_redirect(request: Request, message: str) -> RedirectResponse:
    base_url = _public_base_url(request)
    fragment = urlencode({"oauth_error": message[:240]})
    return RedirectResponse(url=f"{base_url}/index.html#{fragment}", status_code=status.HTTP_302_FOUND)


def _oauth_success_redirect(
    request: Request,
    token: str,
    customer_payload: CustomerResponse,
    next_path: str,
) -> RedirectResponse:
    base_url = _public_base_url(request)
    fragment = urlencode({
        "oauth_token": token,
        "oauth_customer": _base64url_encode(customer_payload.model_dump_json()),
        "oauth_next": _safe_next_path(next_path),
    })
    return RedirectResponse(url=f"{base_url}/index.html#{fragment}", status_code=status.HTTP_302_FOUND)


def _cleanup_oauth_states() -> None:
    now_ts = datetime.now(timezone.utc).timestamp()
    expired_states = [
        state
        for state, payload in _oauth_state_store.items()
        if (now_ts - payload.get("created_at_ts", 0)) > OAUTH_STATE_TTL_SECONDS
    ]
    for state in expired_states:
        _oauth_state_store.pop(state, None)


def _oauth_google_config() -> dict[str, str] | None:
    client_id = os.getenv("OAUTH_GOOGLE_CLIENT_ID", "").strip()
    client_secret = os.getenv("OAUTH_GOOGLE_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv("OAUTH_GOOGLE_REDIRECT_URI", "").strip()
    if not client_id or not client_secret or not redirect_uri:
        return None
    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
    }


async def _find_or_create_oauth_customer(*, email: str, full_name: str, db: AsyncSession) -> Customer:
    result = await db.execute(select(Customer).where(Customer.email == email))
    customer = result.scalar_one_or_none()
    if customer is not None:
        if not customer.is_active:
            customer.is_active = True
            customer.full_name = customer.full_name or full_name
            db.add(customer)
            await db.commit()
            await db.refresh(customer)
        return customer

    customer = Customer(
        customer_id=uuid.uuid4(),
        email=email,
        password_hash=hash_password(secrets.token_urlsafe(24)),
        full_name=full_name,
        phone=None,
        is_active=True,
    )
    db.add(customer)
    await db.commit()
    await db.refresh(customer)
    return customer


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/register")
async def register(payload: CustomerRegisterRequest, db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(select(Customer).where(Customer.email == payload.email))
    customer = result.scalar_one_or_none()

    if customer is not None:
        if customer.is_active:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
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

    await _create_and_send_otp(customer, db, purpose="register")
    return {"requires_otp": True, "message": f"Verification code sent to {customer.email}"}


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
        return {"message": "If this email exists, a new code has been sent"}

    await _create_and_send_otp(customer, db, purpose="login")
    return {"message": f"New verification code sent to {customer.email}"}


@app.get("/oauth/start")
async def oauth_start(
    request: Request,
    provider: str = Query(default="google"),
    next: str = Query(default="/banking"),
) -> RedirectResponse:
    if provider.lower() != "google":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported OAuth provider")

    oauth_config = _oauth_google_config()
    if oauth_config is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google OAuth is not configured")

    _cleanup_oauth_states()
    state = secrets.token_urlsafe(24)
    _oauth_state_store[state] = {
        "created_at_ts": datetime.now(timezone.utc).timestamp(),
        "next_path": _safe_next_path(next),
    }

    query = urlencode({
        "client_id": oauth_config["client_id"],
        "redirect_uri": oauth_config["redirect_uri"],
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    })
    return RedirectResponse(url=f"{GOOGLE_AUTHORIZE_URL}?{query}", status_code=status.HTTP_302_FOUND)


@app.get("/oauth/callback")
async def oauth_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
    provider: str = Query(default="google"),
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> RedirectResponse:
    if provider.lower() != "google":
        return _oauth_error_redirect(request, "Unsupported OAuth provider")

    if error:
        return _oauth_error_redirect(request, error)
    if not code or not state:
        return _oauth_error_redirect(request, "Missing OAuth callback parameters")

    oauth_state = _oauth_state_store.pop(state, None)
    if oauth_state is None:
        return _oauth_error_redirect(request, "Invalid or expired OAuth state")

    if (datetime.now(timezone.utc).timestamp() - oauth_state.get("created_at_ts", 0)) > OAUTH_STATE_TTL_SECONDS:
        return _oauth_error_redirect(request, "OAuth session expired, please try again")

    oauth_config = _oauth_google_config()
    if oauth_config is None:
        return _oauth_error_redirect(request, "Google OAuth is not configured")

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            token_response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": oauth_config["client_id"],
                    "client_secret": oauth_config["client_secret"],
                    "redirect_uri": oauth_config["redirect_uri"],
                    "grant_type": "authorization_code",
                },
            )
            token_response.raise_for_status()
            token_payload = token_response.json()
            provider_token = str(token_payload.get("access_token", "")).strip()
            if not provider_token:
                return _oauth_error_redirect(request, "OAuth token exchange failed")

            userinfo_response = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {provider_token}"},
            )
            userinfo_response.raise_for_status()
            userinfo_payload = userinfo_response.json()
    except httpx.HTTPError:
        return _oauth_error_redirect(request, "OAuth provider request failed")

    email = str(userinfo_payload.get("email", "")).strip().lower()
    if not email:
        return _oauth_error_redirect(request, "OAuth account is missing an email")
    if not bool(userinfo_payload.get("email_verified", False)):
        return _oauth_error_redirect(request, "OAuth email is not verified")

    full_name = str(userinfo_payload.get("name", "")).strip() or email.split("@")[0]
    customer = await _find_or_create_oauth_customer(email=email, full_name=full_name, db=db)

    token = create_access_token(str(customer.customer_id))
    return _oauth_success_redirect(
        request=request,
        token=token,
        customer_payload=CustomerResponse.model_validate(customer),
        next_path=oauth_state.get("next_path", "/banking"),
    )


@app.get("/lookup")
async def lookup_customer(
    query: str = Query(..., description="Email address or phone number (with country code)"),
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
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

    return {
        "customer_id": str(found.customer_id),
        "full_name": found.full_name,
        "email": found.email,
    }


@app.get("/internal/contact/{customer_id}")
async def internal_get_contact(customer_id: str, db: AsyncSession = Depends(get_db)) -> Any:
    try:
        uid = uuid.UUID(customer_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid customer_id") from exc

    result = await db.execute(select(Customer).where(Customer.customer_id == uid, Customer.is_active == True))  # noqa: E712
    customer = result.scalar_one_or_none()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    return {
        "customer_id": str(customer.customer_id),
        "full_name": customer.full_name,
        "email": customer.email,
        "phone": customer.phone,
    }


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

    current.is_active = False
    db.add(current)
    await db.commit()
    return {"message": "Account deleted successfully"}
