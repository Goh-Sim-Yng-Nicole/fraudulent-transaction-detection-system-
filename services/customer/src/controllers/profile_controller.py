from __future__ import annotations

import re
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.customer.src.models.customer import Customer
from services.customer.src.repositories.customer_repository import create_and_send_otp, verify_otp
from services.customer.src.utils.password_utils import has_local_password, hash_password, verify_password


class ProfileController:
    def _require_local_password(self, customer: Customer, action: str) -> None:
        if has_local_password(customer.password_hash):
            return
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail=f"Set a local password before you can {action}",
        )

    async def lookup(self, query: str, current: Customer, db: AsyncSession) -> dict:
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

    async def get_contact(self, customer_id: str, db: AsyncSession) -> dict:
        try:
            uid = uuid.UUID(customer_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid customer_id")
        result = await db.execute(
            select(Customer).where(Customer.customer_id == uid, Customer.is_active == True)  # noqa: E712
        )
        c = result.scalar_one_or_none()
        if c is None:
            raise HTTPException(status_code=404, detail="Customer not found")
        return {"customer_id": str(c.customer_id), "full_name": c.full_name, "email": c.email, "phone": c.phone}

    async def update_me(self, full_name: str | None, phone: str | None, current: Customer, db: AsyncSession) -> Customer:
        self._require_local_password(current, "update your profile")
        if full_name is not None:
            current.full_name = full_name
        if phone is not None:
            current.phone = phone
        db.add(current)
        await db.commit()
        await db.refresh(current)
        return current

    async def change_password(
        self, current_password: str, new_password: str, otp_code: str, current: Customer, db: AsyncSession
    ) -> None:
        self._require_local_password(current, "change your password")
        if not verify_password(current_password, current.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
        valid = await verify_otp(str(current.customer_id), otp_code, db)
        if not valid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP")
        current.password_hash = hash_password(new_password)
        db.add(current)
        await db.commit()

    async def set_password(self, new_password: str, otp_code: str, current: Customer, db: AsyncSession) -> Customer:
        if has_local_password(current.password_hash):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Password already exists. Use the change password flow instead.",
            )
        valid = await verify_otp(str(current.customer_id), otp_code, db)
        if not valid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP")
        current.password_hash = hash_password(new_password)
        db.add(current)
        await db.commit()
        await db.refresh(current)
        return current

    async def request_otp(self, current: Customer, db: AsyncSession) -> str:
        otp_purpose = "change_password" if has_local_password(current.password_hash) else "set_password"
        await create_and_send_otp(current, db, purpose=otp_purpose)
        return otp_purpose

    async def delete_account(self, password: str, otp_code: str, current: Customer, db: AsyncSession) -> None:
        self._require_local_password(current, "delete your account")
        if not verify_password(password, current.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect password")
        valid = await verify_otp(str(current.customer_id), otp_code, db)
        if not valid:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP")
        current.is_active = False
        db.add(current)
        await db.commit()


profile_controller = ProfileController()
