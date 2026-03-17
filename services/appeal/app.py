from __future__ import annotations

import asyncio
import contextlib
import os
from contextlib import asynccontextmanager
from typing import Any, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from ftds.config import settings
from ftds.event_types import APPEAL_CREATED_V1, APPEAL_RESOLVED_V1
from ftds.events import envelope, get_event_type
from ftds.kafka import create_consumer, create_producer, stop_quietly
from ftds.schemas import AppealCreateRequest, AppealCreated, AppealResolved, utc_now
from services.appeal.db import (
    create_engine,
    create_sessionmaker,
    init_db,
    should_auto_create_tables,
    wait_for_db,
)
from services.appeal.models import Appeal


class AppState:
    def __init__(self) -> None:
        self.engine: Optional[AsyncEngine] = None
        self.sessionmaker: Optional[async_sessionmaker[AsyncSession]] = None
        self.producer = None
        self.consumer = None
        self.consumer_task: Optional[asyncio.Task[None]] = None


state = AppState()


async def _consume_resolutions() -> None:
    assert state.consumer is not None
    async for message in state.consumer:
        value: Any = message.value
        if get_event_type(value) != APPEAL_RESOLVED_V1:
            continue
        data = AppealResolved.model_validate(value.get("data", {}))
        assert state.sessionmaker is not None
        async with state.sessionmaker() as session:
            result = await session.execute(select(Appeal).where(Appeal.appeal_id == data.appeal_id))
            appeal = result.scalar_one_or_none()
            if appeal is None:
                continue
            appeal.status = "RESOLVED"
            appeal.manual_outcome = data.manual_outcome.value
            appeal.outcome_reason = data.outcome_reason
            appeal.updated_at = utc_now()
            await session.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    database_url = os.getenv("DATABASE_URL", "").strip()
    state.engine = create_engine(database_url)
    await wait_for_db(state.engine)
    if should_auto_create_tables():
        await init_db(state.engine)
    state.sessionmaker = create_sessionmaker(state.engine)

    state.producer = await create_producer(bootstrap_servers=settings.kafka_bootstrap_servers)
    state.consumer = await create_consumer(
        topics=[settings.topic_appeal_resolved],
        group_id="appeal-service",
        bootstrap_servers=settings.kafka_bootstrap_servers,
    )
    state.consumer_task = asyncio.create_task(_consume_resolutions())
    try:
        yield
    finally:
        if state.consumer_task is not None:
            state.consumer_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await state.consumer_task
        if state.consumer is not None:
            await stop_quietly(state.consumer)
        if state.producer is not None:
            await stop_quietly(state.producer)
        if state.engine is not None:
            await state.engine.dispose()


app = FastAPI(title="Appeal Service", version="0.1.0", lifespan=lifespan)

@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/appeals")
async def create_appeal(request: AppealCreateRequest) -> dict[str, Any]:
    appeal_id = str(uuid4())
    now = utc_now()
    assert state.sessionmaker is not None
    async with state.sessionmaker() as session:
        session.add(
            Appeal(
                appeal_id=appeal_id,
                transaction_id=request.transaction_id,
                reason_for_appeal=request.reason_for_appeal,
                status="PENDING",
                manual_outcome=None,
                outcome_reason=None,
                created_at=now,
                updated_at=now,
            )
        )
        await session.commit()

    created = AppealCreated(
        appeal_id=appeal_id,
        transaction_id=request.transaction_id,
        reason_for_appeal=request.reason_for_appeal,
    )
    payload = envelope(event_type=APPEAL_CREATED_V1, data=created, trace_id=request.transaction_id)
    assert state.producer is not None
    await state.producer.send_and_wait(settings.topic_appeal_created, payload)
    return {"appeal_id": appeal_id, "status": "PENDING"}


@app.get("/appeals/{appeal_id}")
async def get_appeal(appeal_id: str) -> dict[str, Any]:
    assert state.sessionmaker is not None
    async with state.sessionmaker() as session:
        result = await session.execute(select(Appeal).where(Appeal.appeal_id == appeal_id))
        model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=404, detail="appeal not found")

    response: dict[str, Any] = {
        "appeal": {
            "appeal_id": model.appeal_id,
            "transaction_id": model.transaction_id,
            "reason_for_appeal": model.reason_for_appeal,
        },
        "status": model.status,
    }
    if model.status == "RESOLVED":
        response["resolution"] = {
            "manual_outcome": model.manual_outcome,
            "outcome_reason": model.outcome_reason,
        }
    return response
