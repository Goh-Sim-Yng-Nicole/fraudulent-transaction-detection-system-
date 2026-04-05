from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from services.customer.src.controllers.auth_controller import auth_controller
from services.customer.src.dependencies import get_db

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CustomerRegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    phone: str

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
    has_password: bool
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


class OtpChallengeResponse(BaseModel):
    requires_otp: bool = True
    message: str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/register", response_model=OtpChallengeResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: CustomerRegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    customer = await auth_controller.register(
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
        phone=payload.phone,
        db=db,
    )
    return OtpChallengeResponse(message=f"Verification code sent to {customer.email}")


@router.post("/login")
async def login(
    payload: CustomerLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    customer = await auth_controller.login(email=payload.email, password=payload.password, db=db)
    return {"requires_otp": True, "message": f"Verification code sent to {customer.email}"}


@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp_route(
    payload: VerifyOtpRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    token, customer = await auth_controller.verify_otp(email=payload.email, otp_code=payload.otp_code, db=db)
    return TokenResponse(access_token=token, customer=CustomerResponse.model_validate(customer))


@router.post("/resend-otp")
async def resend_otp(
    payload: ResendOtpRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    await auth_controller.resend_otp(email=payload.email, db=db)
    return {"message": "If this email exists, a new code has been sent"}
