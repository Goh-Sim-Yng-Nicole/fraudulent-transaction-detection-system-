from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _to_float(value: Any) -> float:
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _to_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def _map_row(
    row: Any,
    direction: str | None = None,
    *,
    include_workflow_state: bool = False,
) -> dict[str, Any]:
    record = {
        "transaction_id": str(row["id"]),
        "amount": _to_float(row["amount"]),
        "currency": row["currency"],
        "card_type": row["card_type"],
        "country": row["country"],
        "merchant_id": row["merchant_id"],
        "hour_utc": row["hour_utc"],
        "customer_id": row["customer_id"],
        "sender_name": row["sender_name"],
        "recipient_customer_id": row["recipient_customer_id"],
        "recipient_name": row["recipient_name"],
        "status": row["status"],
        "fraud_score": _to_int_or_none(row["fraud_score"]),
        "outcome_reason": row["outcome_reason"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "direction": direction,
    }

    if include_workflow_state:
        record["outbound_event_published_at"] = row["outbound_event_published_at"]
        record["outbound_event_publish_attempts"] = row["outbound_event_publish_attempts"]
        record["outbound_event_last_error"] = row["outbound_event_last_error"]
        record["correlation_id"] = row["correlation_id"]

    return record


class TransactionStore:
    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
        self._sessionmaker = sessionmaker

    async def ping(self) -> None:
        async with self._sessionmaker() as session:
            await session.execute(text("SELECT 1"))

    async def find_by_id(
        self,
        transaction_id: str,
        *,
        include_workflow_state: bool = False,
    ) -> dict[str, Any] | None:
        async with self._sessionmaker() as session:
            result = await session.execute(
                text("SELECT * FROM transactions WHERE id = :transaction_id"),
                {"transaction_id": transaction_id},
            )
            row = result.mappings().first()

        return _map_row(row, include_workflow_state=include_workflow_state) if row else None

    async def find_by_idempotency_key(
        self,
        idempotency_key: str | None,
        *,
        include_workflow_state: bool = False,
    ) -> dict[str, Any] | None:
        if not idempotency_key:
            return None

        async with self._sessionmaker() as session:
            result = await session.execute(
                text("SELECT * FROM transactions WHERE idempotency_key = :idempotency_key"),
                {"idempotency_key": idempotency_key},
            )
            row = result.mappings().first()

        return _map_row(row, include_workflow_state=include_workflow_state) if row else None

    async def create(
        self,
        payload: dict[str, Any],
        *,
        idempotency_key: str | None,
        correlation_id: str | None,
        request_id: str | None,
    ) -> dict[str, Any]:
        transaction_id = str(uuid4())
        async with self._sessionmaker() as session:
            result = await session.execute(
                text(
                    """
                    INSERT INTO transactions (
                      id,
                      customer_id,
                      sender_name,
                      recipient_customer_id,
                      recipient_name,
                      merchant_id,
                      amount,
                      currency,
                      card_type,
                      country,
                      hour_utc,
                      status,
                      fraud_score,
                      outcome_reason,
                      idempotency_key,
                      correlation_id,
                      request_id
                    ) VALUES (
                      :transaction_id,
                      :customer_id,
                      :sender_name,
                      :recipient_customer_id,
                      :recipient_name,
                      :merchant_id,
                      :amount,
                      :currency,
                      :card_type,
                      :country,
                      :hour_utc,
                      :status,
                      :fraud_score,
                      :outcome_reason,
                      :idempotency_key,
                      :correlation_id,
                      :request_id
                    )
                    RETURNING *
                    """
                ),
                {
                    "transaction_id": transaction_id,
                    "customer_id": payload["customer_id"],
                    "sender_name": payload.get("sender_name"),
                    "recipient_customer_id": payload.get("recipient_customer_id"),
                    "recipient_name": payload.get("recipient_name"),
                    "merchant_id": payload["merchant_id"],
                    "amount": payload["amount"],
                    "currency": payload["currency"],
                    "card_type": payload["card_type"],
                    "country": payload["country"],
                    "hour_utc": payload["hour_utc"],
                    "status": "PENDING",
                    "fraud_score": None,
                    "outcome_reason": None,
                    "idempotency_key": idempotency_key,
                    "correlation_id": correlation_id,
                    "request_id": request_id,
                },
            )
            row = result.mappings().one()
            await session.commit()

        return _map_row(row)

    async def list_by_customer(self, customer_id: str, direction: str = "all") -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []

        async with self._sessionmaker() as session:
            if direction in {"all", "outgoing"}:
                result = await session.execute(
                    text(
                        """
                        SELECT * FROM transactions
                        WHERE customer_id = :customer_id
                        ORDER BY created_at DESC
                        """
                    ),
                    {"customer_id": customer_id},
                )
                records.extend(_map_row(row, "OUTGOING") for row in result.mappings().all())

            if direction in {"all", "incoming"}:
                result = await session.execute(
                    text(
                        """
                        SELECT * FROM transactions
                        WHERE recipient_customer_id = :customer_id
                          AND status = 'APPROVED'
                        ORDER BY created_at DESC
                        """
                    ),
                    {"customer_id": customer_id},
                )
                records.extend(_map_row(row, "INCOMING") for row in result.mappings().all())

        if direction == "all":
            records.sort(key=lambda item: item["created_at"], reverse=True)

        return records

    async def apply_status_update(
        self,
        *,
        transaction_id: str,
        status: str,
        fraud_score: int | None = None,
        outcome_reason: str | None = None,
    ) -> dict[str, Any] | None:
        async with self._sessionmaker() as session:
            result = await session.execute(
                text(
                    """
                    UPDATE transactions
                    SET status = :status,
                        fraud_score = COALESCE(:fraud_score, fraud_score),
                        outcome_reason = COALESCE(:outcome_reason, outcome_reason),
                        updated_at = NOW()
                    WHERE id = :transaction_id
                    RETURNING *
                    """
                ),
                {
                    "transaction_id": transaction_id,
                    "status": status,
                    "fraud_score": fraud_score,
                    "outcome_reason": outcome_reason,
                },
            )
            row = result.mappings().first()
            await session.commit()

        return _map_row(row) if row else None

    async def mark_outbound_event_published(self, transaction_id: str) -> dict[str, Any] | None:
        async with self._sessionmaker() as session:
            result = await session.execute(
                text(
                    """
                    UPDATE transactions
                    SET outbound_event_published_at = NOW(),
                        outbound_event_publish_attempts = outbound_event_publish_attempts + 1,
                        outbound_event_last_error = NULL,
                        updated_at = NOW()
                    WHERE id = :transaction_id
                    RETURNING *
                    """
                ),
                {"transaction_id": transaction_id},
            )
            row = result.mappings().first()
            await session.commit()

        return _map_row(row) if row else None

    async def mark_outbound_event_failed(
        self,
        transaction_id: str,
        error_message: str,
    ) -> dict[str, Any] | None:
        async with self._sessionmaker() as session:
            result = await session.execute(
                text(
                    """
                    UPDATE transactions
                    SET outbound_event_publish_attempts = outbound_event_publish_attempts + 1,
                        outbound_event_last_error = :error_message,
                        updated_at = NOW()
                    WHERE id = :transaction_id
                    RETURNING *
                    """
                ),
                {
                    "transaction_id": transaction_id,
                    "error_message": error_message,
                },
            )
            row = result.mappings().first()
            await session.commit()

        return _map_row(row) if row else None
