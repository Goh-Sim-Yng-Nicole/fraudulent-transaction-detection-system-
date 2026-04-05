from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.customer.src.models.customer import Customer
from services.customer.src.state import state
from services.customer.src.utils.jwt_utils import decode_access_token

security = HTTPBearer()


async def get_db() -> AsyncSession:  # type: ignore[return]
    assert state.session_factory is not None
    async with state.session_factory() as session:
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
