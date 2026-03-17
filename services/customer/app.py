from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, AsyncEngine

from services.customer.auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from services.customer.db import (
    create_engine,
    create_sessionmaker,
    should_auto_create_tables,
    init_db,
    wait_for_db,
)
from services.customer.models import Customer


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class CustomerRegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: str | None = None

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        return v


class CustomerLoginRequest(BaseModel):
    email: EmailStr
    password: str


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


# ---------------------------------------------------------------------------
# App state
# ---------------------------------------------------------------------------

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


app = FastAPI(title="FTDS Customer Service", version="0.1.0", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: CustomerRegisterRequest, db: AsyncSession = Depends(get_db)) -> Any:
    existing = await db.execute(select(Customer).where(Customer.email == payload.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )
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
    return TokenResponse(
        access_token=token,
        customer=CustomerResponse.model_validate(customer),
    )


@app.post("/login", response_model=TokenResponse)
async def login(payload: CustomerLoginRequest, db: AsyncSession = Depends(get_db)) -> Any:
    result = await db.execute(select(Customer).where(Customer.email == payload.email))
    customer = result.scalar_one_or_none()
    if customer is None or not verify_password(payload.password, customer.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not customer.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive",
        )
    token = create_access_token(str(customer.customer_id))
    return TokenResponse(
        access_token=token,
        customer=CustomerResponse.model_validate(customer),
    )


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
