from __future__ import annotations

import asyncio
import contextlib
import os
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import RedirectResponse, Response

from ftds import kafka
from ftds.config import settings
from ftds.event_types import (
    APPEAL_RESOLVED_V1,
    TRANSACTION_CREATED_V1,
    TRANSACTION_FINALISED_V1,
    TRANSACTION_FLAGGED_V1,
    TRANSACTION_REVIEWED_V1,
    TRANSACTION_SCORED_V1,
)
from ftds.events import envelope, get_event_type
from ftds.schemas import (
    AppealResolved,
    TransactionCreateRequest,
    TransactionCreated,
    TransactionFinalised,
    TransactionFlagged,
    TransactionReviewed,
    TransactionScored,
    TransactionStatus,
)

from services.transaction.db import (
    create_engine,
    create_sessionmaker,
    init_db,
    should_auto_create_tables,
    wait_for_db,
)

from .store import TransactionStore


class AppState:
    def __init__(self) -> None:
        self.engine = None
        self.sessionmaker = None
        self.store: Optional[TransactionStore] = None
        self.producer = None
        self.consumer = None
        self.consumer_task: Optional[asyncio.Task[None]] = None


state = AppState()


async def _consume_updates() -> None:
    assert state.consumer is not None
    async for message in state.consumer:
        value: Any = message.value
        event_type = get_event_type(value)
        if event_type is None:
            continue
        data = value.get("data", {}) if isinstance(value, dict) else {}

        if event_type == TRANSACTION_SCORED_V1:
            scored = TransactionScored.model_validate(data)
            assert state.store is not None
            await state.store.set_score(scored.transaction_id, scored.rules_score)
            continue

        if event_type == TRANSACTION_FLAGGED_V1:
            flagged = TransactionFlagged.model_validate(data)
            assert state.store is not None
            await state.store.set_score(flagged.transaction_id, flagged.rules_score)
            await state.store.set_status(
                flagged.transaction_id, TransactionStatus.FLAGGED, reason=flagged.reason
            )
            continue

        if event_type == TRANSACTION_FINALISED_V1:
            finalised = TransactionFinalised.model_validate(data)
            assert state.store is not None
            await state.store.set_score(finalised.transaction_id, finalised.rules_score)
            status = (
                TransactionStatus.APPROVED
                if finalised.outcome == "APPROVED"
                else TransactionStatus.REJECTED
            )
            await state.store.set_status(finalised.transaction_id, status, reason=finalised.reason)
            continue

        if event_type == TRANSACTION_REVIEWED_V1:
            reviewed = TransactionReviewed.model_validate(data)
            assert state.store is not None
            await state.store.set_status(
                reviewed.transaction_id,
                TransactionStatus.RESOLVED,
                reason=f"{reviewed.manual_outcome}: {reviewed.reason}",
            )
            continue

        if event_type == APPEAL_RESOLVED_V1:
            resolved = AppealResolved.model_validate(data)
            assert state.store is not None
            await state.store.set_status(
                resolved.transaction_id,
                TransactionStatus.RESOLVED,
                reason=f"{resolved.manual_outcome}: {resolved.outcome_reason}",
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    database_url = os.getenv("DATABASE_URL", "").strip()
    state.engine = create_engine(database_url)
    await wait_for_db(state.engine)
    if should_auto_create_tables():
        await init_db(state.engine)
    state.sessionmaker = create_sessionmaker(state.engine)
    state.store = TransactionStore(state.sessionmaker)

    state.producer = await kafka.create_producer(bootstrap_servers=settings.kafka_bootstrap_servers)
    state.consumer = await kafka.create_consumer(
        topics=[
            settings.topic_transaction_scored,
            settings.topic_transaction_flagged,
            settings.topic_transaction_finalised,
            settings.topic_transaction_reviewed,
            settings.topic_appeal_resolved,
        ],
        group_id="transaction-service",
        bootstrap_servers=settings.kafka_bootstrap_servers,
    )
    state.consumer_task = asyncio.create_task(_consume_updates())
    try:
        yield
    finally:
        if state.consumer_task is not None:
            state.consumer_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await state.consumer_task
        if state.consumer is not None:
            await kafka.stop_quietly(state.consumer)
        if state.producer is not None:
            await kafka.stop_quietly(state.producer)
        if state.engine is not None:
            await state.engine.dispose()


app = FastAPI(title="Transaction Service", version="0.1.0", lifespan=lifespan)

@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/transactions")
async def list_transactions(
    customer_id: str = Query(...),
    direction: str = Query("all"),
) -> list[dict[str, Any]]:
    if direction not in ("all", "outgoing", "incoming"):
        raise HTTPException(status_code=400, detail="direction must be all, outgoing, or incoming")
    assert state.store is not None
    records = await state.store.list_by_customer(customer_id, direction=direction)
    return [r.model_dump(mode="json") for r in records]


@app.post("/transactions")
async def create_transaction(request: TransactionCreateRequest) -> dict[str, Any]:
    assert state.store is not None
    record = await state.store.create(request)
    created = TransactionCreated(
        transaction_id=record.transaction_id,
        amount=record.amount,
        currency=record.currency,
        card_type=record.card_type,
        country=record.country,
        merchant_id=record.merchant_id,
        hour_utc=record.hour_utc,
    )
    payload = envelope(event_type=TRANSACTION_CREATED_V1, data=created, trace_id=record.transaction_id)
    assert state.producer is not None
    await state.producer.send_and_wait(settings.topic_transaction_created, payload)
    return record.model_dump(mode="json")


@app.get("/transactions/{transaction_id}")
async def get_transaction(transaction_id: str) -> dict[str, Any]:
    assert state.store is not None
    record = await state.store.get(transaction_id)
    if record is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return record.model_dump(mode="json")


@app.get("/transactions/{transaction_id}/decision")
async def get_transaction_decision(transaction_id: str) -> dict[str, Any]:
    assert state.store is not None
    record = await state.store.get(transaction_id)
    if record is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return {
        "transaction_id": record.transaction_id,
        "status": record.status,
        "fraud_score": record.fraud_score,
        "outcome_reason": record.outcome_reason,
        "updated_at": record.updated_at,
    }
