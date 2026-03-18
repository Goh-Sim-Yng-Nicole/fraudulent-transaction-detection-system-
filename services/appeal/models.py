from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Appeal(Base):
    __tablename__ = "appeals"

    appeal_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    transaction_id: Mapped[str] = mapped_column(String(36), index=True)
    customer_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    reason_for_appeal: Mapped[str] = mapped_column(Text)

    status: Mapped[str] = mapped_column(String(16), index=True)  # PENDING/RESOLVED
    manual_outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    outcome_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

