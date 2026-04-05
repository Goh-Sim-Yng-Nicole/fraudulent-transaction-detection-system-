from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.customer.src.models.customer import Customer
from services.customer.src.repositories.customer_repository import create_and_send_otp, verify_otp
from services.customer.src.utils.jwt_utils import create_access_token
from services.customer.src.utils.password_utils import (
    has_local_password,
    hash_password,
    verify_password,
)


class AuthController:
    async def register(self, email: str, password: str, full_name: str, phone: str, db: AsyncSession) -> Customer:
        result = await db.execute(select(Customer).where(Customer.email == email))
        customer = result.scalar_one_or_none()

        if customer is not None:
            if customer.is_active:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
            customer.full_name = full_name
            customer.phone = phone
            customer.password_hash = hash_password(password)
            customer.is_active = True
        else:
            customer = Customer(
                customer_id=uuid.uuid4(),
                email=email,
                password_hash=hash_password(password),
                full_name=full_name,
                phone=phone,
            )
            db.add(customer)

        await db.commit()
        await db.refresh(customer)
        await create_and_send_otp(customer, db, purpose="register")
        return customer

    async def login(self, email: str, password: str, db: AsyncSession) -> Customer:
        result = await db.execute(select(Customer).where(Customer.email == email))
        customer = result.scalar_one_or_none()

        if customer is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account does not exist")
        if not has_local_password(customer.password_hash):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account does not support password sign-in until a local password is set.",
            )
        if not verify_password(password, customer.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")
        if not customer.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

        await create_and_send_otp(customer, db, purpose="login")
        return customer

    async def verify_otp(self, email: str, otp_code: str, db: AsyncSession) -> tuple[str, Customer]:
        result = await db.execute(select(Customer).where(Customer.email == email))
        customer = result.scalar_one_or_none()
        if customer is None or not customer.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid request")

        valid = await verify_otp(str(customer.customer_id), otp_code, db)
        if not valid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP")

        token = create_access_token(str(customer.customer_id))
        return token, customer

    async def resend_otp(self, email: str, db: AsyncSession) -> None:
        result = await db.execute(select(Customer).where(Customer.email == email))
        customer = result.scalar_one_or_none()
        if customer is None or not customer.is_active:
            return  # Silent no-op to prevent email enumeration
        await create_and_send_otp(customer, db, purpose="login")


auth_controller = AuthController()
