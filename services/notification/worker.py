from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx

from ftds.config import settings
from ftds.event_types import (
    APPEAL_RESOLVED_V1,
    TRANSACTION_FINALISED_V1,
    TRANSACTION_FLAGGED_V1,
    TRANSACTION_REVIEWED_V1,
)
from ftds.events import get_event_type
from ftds.kafka import create_consumer, stop_quietly
from ftds.notifications import (
    send_appeal_resolved_notification,
    send_transaction_finalised_notification,
    send_transaction_flagged_notification,
    send_transaction_reviewed_notification,
    send_transfer_notification,
)
from ftds.schemas import AppealResolved, TransactionFinalised, TransactionFlagged, TransactionReviewed

TRANSACTION_BASE = lambda: os.getenv("TRANSACTION_BASE_URL", "http://transaction:8000")
CUSTOMER_BASE    = lambda: os.getenv("CUSTOMER_BASE_URL",    "http://customer:8005")


async def _get_transaction(txn_id: str) -> dict[str, Any] | None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{TRANSACTION_BASE()}/transactions/{txn_id}")
        return r.json() if r.status_code == 200 else None
    except Exception as exc:
        print(f"[notification] fetch transaction {txn_id} failed: {exc}", flush=True)
        return None


async def _get_contact(customer_id: str) -> dict[str, Any] | None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{CUSTOMER_BASE()}/internal/contact/{customer_id}")
        return r.json() if r.status_code == 200 else None
    except Exception as exc:
        print(f"[notification] fetch contact {customer_id} failed: {exc}", flush=True)
        return None


# ── Event handlers ────────────────────────────────────────────────────────────

async def _on_flagged(data: dict[str, Any]) -> None:
    """Scenario 2 step 3b — notify customer that their transaction is under review."""
    flagged = TransactionFlagged.model_validate(data)
    txn = await _get_transaction(flagged.transaction_id)
    if not txn or not txn.get("customer_id"):
        return
    contact = await _get_contact(txn["customer_id"])
    if not contact:
        return
    await send_transaction_flagged_notification(
        to_email=contact["email"],
        to_phone=contact.get("phone"),
        to_name=contact["full_name"],
        currency=txn["currency"],
        amount=txn["amount"],
        transaction_id=flagged.transaction_id,
    )


async def _on_finalised(data: dict[str, Any]) -> None:
    """Scenario 1 step 3b — notify sender of outcome.
       Scenario 1 step 3b (P2P APPROVED) — also notify recipient."""
    finalised = TransactionFinalised.model_validate(data)
    txn = await _get_transaction(finalised.transaction_id)
    if not txn:
        return

    # Notify sender of outcome (APPROVED or REJECTED)
    if txn.get("customer_id"):
        contact = await _get_contact(txn["customer_id"])
        if contact:
            await send_transaction_finalised_notification(
                to_email=contact["email"],
                to_phone=contact.get("phone"),
                to_name=contact["full_name"],
                outcome=finalised.outcome,
                currency=txn["currency"],
                amount=txn["amount"],
                transaction_id=finalised.transaction_id,
                reason=finalised.reason,
            )

    # Also notify P2P recipient if APPROVED transfer
    if finalised.outcome == "APPROVED" and txn.get("recipient_customer_id"):
        recipient = await _get_contact(txn["recipient_customer_id"])
        if recipient:
            await send_transfer_notification(
                to_email=recipient["email"],
                to_phone=recipient.get("phone"),
                to_name=recipient["full_name"],
                from_name=txn.get("sender_name") or "An FTDS customer",
                currency=txn["currency"],
                amount=txn["amount"],
                transaction_id=finalised.transaction_id,
            )


async def _on_reviewed(data: dict[str, Any]) -> None:
    """Scenario 2 step 3b — notify customer of manual review outcome."""
    reviewed = TransactionReviewed.model_validate(data)
    txn = await _get_transaction(reviewed.transaction_id)
    if not txn or not txn.get("customer_id"):
        return
    contact = await _get_contact(txn["customer_id"])
    if not contact:
        return
    await send_transaction_reviewed_notification(
        to_email=contact["email"],
        to_phone=contact.get("phone"),
        to_name=contact["full_name"],
        outcome=reviewed.manual_outcome.value,
        transaction_id=reviewed.transaction_id,
        reason=reviewed.reason,
    )


async def _on_appeal_resolved(data: dict[str, Any]) -> None:
    """Scenario 3 — notify customer of appeal resolution."""
    resolved = AppealResolved.model_validate(data)
    txn = await _get_transaction(resolved.transaction_id)
    if not txn or not txn.get("customer_id"):
        return
    contact = await _get_contact(txn["customer_id"])
    if not contact:
        return
    await send_appeal_resolved_notification(
        to_email=contact["email"],
        to_phone=contact.get("phone"),
        to_name=contact["full_name"],
        outcome=resolved.manual_outcome.value,
        transaction_id=resolved.transaction_id,
        appeal_id=resolved.appeal_id,
        reason=resolved.outcome_reason,
    )


# ── Main loop ─────────────────────────────────────────────────────────────────

_HANDLERS = {
    TRANSACTION_FLAGGED_V1:   _on_flagged,
    TRANSACTION_FINALISED_V1: _on_finalised,
    TRANSACTION_REVIEWED_V1:  _on_reviewed,
    APPEAL_RESOLVED_V1:       _on_appeal_resolved,
}


async def main() -> None:
    consumer = await create_consumer(
        topics=[
            settings.topic_transaction_flagged,
            settings.topic_transaction_finalised,
            settings.topic_transaction_reviewed,
            settings.topic_appeal_resolved,
        ],
        group_id="notification",
        bootstrap_servers=settings.kafka_bootstrap_servers,
    )
    try:
        async for message in consumer:
            value: Any = message.value
            event_type = get_event_type(value)
            handler = _HANDLERS.get(event_type)
            if handler:
                data = value.get("data", {}) if isinstance(value, dict) else {}
                try:
                    await handler(data)
                except Exception as exc:
                    print(f"[notification] handler {event_type} failed: {exc}", flush=True)
    finally:
        await stop_quietly(consumer)


if __name__ == "__main__":
    asyncio.run(main())
