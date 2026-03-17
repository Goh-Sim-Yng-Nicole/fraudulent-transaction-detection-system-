from __future__ import annotations

from typing import Optional
from uuid import uuid4

from sqlalchemy import or_, select, desc
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from services.transaction.models import Transaction
from ftds.schemas import TransactionCreateRequest, TransactionRecord, TransactionStatus, utc_now


def _to_record(model: Transaction, direction: Optional[str] = None) -> TransactionRecord:
    return TransactionRecord(
        transaction_id=model.transaction_id,
        amount=model.amount,
        currency=model.currency,
        card_type=model.card_type,
        country=model.country,
        merchant_id=model.merchant_id,
        hour_utc=model.hour_utc,
        customer_id=model.customer_id,
        sender_name=model.sender_name,
        recipient_customer_id=model.recipient_customer_id,
        recipient_name=model.recipient_name,
        status=TransactionStatus(model.status),
        created_at=model.created_at,
        updated_at=model.updated_at,
        fraud_score=model.fraud_score,
        outcome_reason=model.outcome_reason,
        direction=direction,
    )


class TransactionStore:
    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
        self._sessionmaker = sessionmaker

    async def create(self, request: TransactionCreateRequest) -> TransactionRecord:
        transaction_id = str(uuid4())
        now = utc_now()
        data = request.model_dump()
        if data.get("hour_utc") is None:
            data["hour_utc"] = now.hour
        if not data.get("merchant_id"):
            data["merchant_id"] = "FTDS_TRANSFER"
        model = Transaction(
            transaction_id=transaction_id,
            status=TransactionStatus.PENDING.value,
            created_at=now,
            updated_at=now,
            fraud_score=None,
            outcome_reason=None,
            **data,
        )
        # customer_id is included via model_dump() from request
        async with self._sessionmaker() as session:
            session.add(model)
            await session.commit()
            await session.refresh(model)
        return _to_record(model)

    async def get(self, transaction_id: str) -> Optional[TransactionRecord]:
        async with self._sessionmaker() as session:
            result = await session.execute(
                select(Transaction).where(Transaction.transaction_id == transaction_id)
            )
            model = result.scalar_one_or_none()
        return _to_record(model) if model is not None else None

    async def set_score(self, transaction_id: str, score: int) -> None:
        async with self._sessionmaker() as session:
            result = await session.execute(
                select(Transaction).where(Transaction.transaction_id == transaction_id)
            )
            model = result.scalar_one_or_none()
            if model is None:
                return
            model.fraud_score = int(score)
            model.updated_at = utc_now()
            await session.commit()

    async def set_status(
        self, transaction_id: str, status: TransactionStatus, reason: Optional[str] = None
    ) -> None:
        async with self._sessionmaker() as session:
            result = await session.execute(
                select(Transaction).where(Transaction.transaction_id == transaction_id)
            )
            model = result.scalar_one_or_none()
            if model is None:
                return
            model.status = status.value
            model.outcome_reason = reason
            model.updated_at = utc_now()
            await session.commit()

    async def list_by_customer(
        self, customer_id: str, direction: str = "all"
    ) -> list[TransactionRecord]:
        records: list[TransactionRecord] = []
        async with self._sessionmaker() as session:
            if direction in ("all", "outgoing"):
                result = await session.execute(
                    select(Transaction)
                    .where(Transaction.customer_id == customer_id)
                    .order_by(desc(Transaction.created_at))
                )
                for m in result.scalars().all():
                    records.append(_to_record(m, direction="OUTGOING"))

            if direction in ("all", "incoming"):
                result = await session.execute(
                    select(Transaction)
                    .where(
                        Transaction.recipient_customer_id == customer_id,
                        Transaction.status == TransactionStatus.APPROVED.value,
                    )
                    .order_by(desc(Transaction.created_at))
                )
                for m in result.scalars().all():
                    records.append(_to_record(m, direction="INCOMING"))

        if direction == "all":
            records.sort(key=lambda r: r.created_at, reverse=True)
        return records
