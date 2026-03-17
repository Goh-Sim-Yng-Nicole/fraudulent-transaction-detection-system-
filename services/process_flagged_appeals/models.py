from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class FlaggedCase(Base):
    __tablename__ = "flagged_cases"

    transaction_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    rules_score: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)

    status: Mapped[str] = mapped_column(String(16), index=True)  # FLAGGED/RESOLVED
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class AppealInbox(Base):
    __tablename__ = "appeal_inbox"

    appeal_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    transaction_id: Mapped[str] = mapped_column(String(36), index=True)
    reason_for_appeal: Mapped[str] = mapped_column(Text)

    status: Mapped[str] = mapped_column(String(16), index=True)  # PENDING/RESOLVED
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

