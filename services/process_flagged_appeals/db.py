from __future__ import annotations

import asyncio
import os
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from services.process_flagged_appeals.models import Base


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def create_engine(database_url: str) -> AsyncEngine:
    url = (database_url or "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not set for fraud-review service")
    return create_async_engine(url, pool_pre_ping=True)


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def wait_for_db(engine: AsyncEngine, *, timeout_seconds: int = 30) -> None:
    deadline = asyncio.get_event_loop().time() + timeout_seconds
    last_error: Optional[Exception] = None
    while asyncio.get_event_loop().time() < deadline:
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return
        except Exception as exc:
            last_error = exc
            await asyncio.sleep(1)
    raise RuntimeError(f"Database not ready after {timeout_seconds}s") from last_error


async def init_db(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def should_auto_create_tables() -> bool:
    return _env_bool("AUTO_CREATE_TABLES", False)

