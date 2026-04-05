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

DDL_STATEMENTS = [
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
    """
    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      customer_id VARCHAR(255) NOT NULL,
      sender_name VARCHAR(255),
      recipient_customer_id VARCHAR(255),
      recipient_name VARCHAR(255),
      merchant_id VARCHAR(255) NOT NULL DEFAULT 'FTDS_TRANSFER',
      amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
      currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
      card_type VARCHAR(32) NOT NULL DEFAULT 'CREDIT',
      country VARCHAR(8) NOT NULL,
      hour_utc INTEGER NOT NULL CHECK (hour_utc >= 0 AND hour_utc <= 23),
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      fraud_score INTEGER,
      outcome_reason TEXT,
      idempotency_key VARCHAR(255) UNIQUE,
      correlation_id VARCHAR(255),
      request_id VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);",
    """
    CREATE INDEX IF NOT EXISTS idx_transactions_recipient_customer_id
    ON transactions(recipient_customer_id);
    """,
    "CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);",
    """
    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS outbound_event_published_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS outbound_event_publish_attempts INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS outbound_event_last_error TEXT;
    """,
    """
    CREATE OR REPLACE FUNCTION set_transaction_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """,
    "DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;",
    """
    CREATE TRIGGER trg_transactions_updated_at
      BEFORE UPDATE ON transactions
      FOR EACH ROW EXECUTE FUNCTION set_transaction_updated_at();
    """,
]


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def create_engine(database_url: str) -> AsyncEngine:
    url = (database_url or "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not set for transaction service")
    return create_async_engine(url, pool_pre_ping=True)


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def wait_for_db(engine: AsyncEngine, *, timeout_seconds: int = 60) -> None:
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
        for statement in DDL_STATEMENTS:
            await conn.execute(text(statement))


def should_auto_create_tables() -> bool:
    return _env_bool("AUTO_CREATE_TABLES", False)
