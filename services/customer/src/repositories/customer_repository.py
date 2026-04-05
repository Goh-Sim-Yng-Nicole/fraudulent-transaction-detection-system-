from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.customer.src.config.settings import OTP_EXPIRY_MINUTES
from services.customer.src.models.customer import Customer, OtpCode
from services.customer.src.utils.email_utils import send_otp_email
from services.customer.src.utils.otp_utils import generate_otp_code


async def create_and_send_otp(customer: Customer, db: AsyncSession, purpose: str = "login") -> None:
    """Invalidate previous OTPs, create a new one, and email it."""
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


async def verify_otp(customer_id: str, code: str, db: AsyncSession) -> bool:
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
