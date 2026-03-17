from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from typing import Optional


class Base(DeclarativeBase):
    pass


class Transaction(Base):
    __tablename__ = "transactions"

    transaction_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    amount: Mapped[float] = mapped_column()
    currency: Mapped[str] = mapped_column(String(10))
    card_type: Mapped[str] = mapped_column(String(32))
    country: Mapped[str] = mapped_column(String(8))
    merchant_id: Mapped[str] = mapped_column(String(64))
    hour_utc: Mapped[int] = mapped_column(Integer)

    customer_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    fraud_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outcome_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

