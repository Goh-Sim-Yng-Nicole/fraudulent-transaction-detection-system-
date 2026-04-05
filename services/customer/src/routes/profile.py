from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from services.customer.src.controllers.profile_controller import profile_controller
from services.customer.src.dependencies import get_current_customer, get_db
from services.customer.src.models.customer import Customer
from services.customer.src.routes.auth import CustomerResponse

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

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


class SetPasswordRequest(BaseModel):
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


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/lookup")
async def lookup_customer(
    query: str = Query(..., description="Email address or phone number (with country code)"),
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    return await profile_controller.lookup(query=query, current=current, db=db)


@router.get("/internal/contact/{customer_id}")
async def internal_get_contact(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
) -> Any:
    return await profile_controller.get_contact(customer_id=customer_id, db=db)


@router.get("/me", response_model=CustomerResponse)
async def get_me(current: Customer = Depends(get_current_customer)) -> Any:
    return CustomerResponse.model_validate(current)


@router.put("/me", response_model=CustomerResponse)
async def update_me(
    payload: CustomerUpdateRequest,
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    customer = await profile_controller.update_me(
        full_name=payload.full_name, phone=payload.phone, current=current, db=db
    )
    return CustomerResponse.model_validate(customer)


@router.put("/me/password")
async def change_password(
    payload: ChangePasswordRequest,
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    await profile_controller.change_password(
        current_password=payload.current_password,
        new_password=payload.new_password,
        otp_code=payload.otp_code,
        current=current,
        db=db,
    )
    return {"message": "Password changed successfully"}


@router.post("/me/password/set")
async def set_password(
    payload: SetPasswordRequest,
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    customer = await profile_controller.set_password(
        new_password=payload.new_password, otp_code=payload.otp_code, current=current, db=db
    )
    return {"message": "Password set successfully", "customer": CustomerResponse.model_validate(customer)}


@router.post("/me/request-otp")
async def request_sensitive_otp(
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    await profile_controller.request_otp(current=current, db=db)
    return {"message": f"Verification code sent to {current.email}"}


@router.delete("/me")
async def delete_account(
    payload: DeleteAccountRequest,
    current: Customer = Depends(get_current_customer),
    db: AsyncSession = Depends(get_db),
) -> Any:
    await profile_controller.delete_account(
        password=payload.password, otp_code=payload.otp_code, current=current, db=db
    )
    return {"message": "Account deleted successfully"}
