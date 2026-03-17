from __future__ import annotations

import asyncio
import contextlib
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import RedirectResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt as jose_jwt
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from ftds.config import settings
from ftds.event_types import (
    APPEAL_CREATED_V1,
    APPEAL_RESOLVED_V1,
    TRANSACTION_FLAGGED_V1,
    TRANSACTION_REVIEWED_V1,
)
from ftds.events import envelope, get_event_type
from ftds.kafka import create_consumer, create_producer, stop_quietly
from ftds.schemas import (
    AppealCreated,
    AppealResolved,
    ManualOutcome,
    TransactionFlagged,
    TransactionReviewed,
    utc_now,
)

from services.process_flagged_appeals.db import (
    create_engine,
    create_sessionmaker,
    init_db,
    should_auto_create_tables,
    wait_for_db,
)
from services.process_flagged_appeals.models import AppealInbox, FlaggedCase

_ANALYST_JWT_SECRET = os.getenv("ANALYST_JWT_SECRET", "analyst-dev-secret-change-in-prod")
_ANALYST_USERNAME   = os.getenv("ANALYST_USERNAME", "analyst")
_ANALYST_PASSWORD   = os.getenv("ANALYST_PASSWORD", "analyst123")

_bearer = HTTPBearer()

def _make_analyst_token() -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    return jose_jwt.encode({"sub": "analyst", "exp": exp}, _ANALYST_JWT_SECRET, algorithm="HS256")

def _require_analyst(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    try:
        payload = jose_jwt.decode(creds.credentials, _ANALYST_JWT_SECRET, algorithms=["HS256"])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="invalid or expired token")


class AppState:
    def __init__(self) -> None:
        self.engine: Optional[AsyncEngine] = None
        self.sessionmaker: Optional[async_sessionmaker[AsyncSession]] = None
        self.producer = None
        self.consumer = None
        self.consumer_task: Optional[asyncio.Task[None]] = None


state = AppState()


async def _consume_cases() -> None:
    assert state.consumer is not None
    async for message in state.consumer:
        value: Any = message.value
        event_type = get_event_type(value)
        if event_type is None:
            continue
        data = value.get("data", {}) if isinstance(value, dict) else {}
        assert state.sessionmaker is not None
        now = utc_now()
        async with state.sessionmaker() as session:
            if event_type == TRANSACTION_FLAGGED_V1:
                flagged = TransactionFlagged.model_validate(data)
                stmt = insert(FlaggedCase).values(
                    transaction_id=flagged.transaction_id,
                    rules_score=flagged.rules_score,
                    reason=flagged.reason,
                    status="FLAGGED",
                    created_at=now,
                    updated_at=now,
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=[FlaggedCase.transaction_id],
                    set_={
                        "rules_score": flagged.rules_score,
                        "reason": flagged.reason,
                        "status": "FLAGGED",
                        "updated_at": now,
                    },
                )
                await session.execute(stmt)
                await session.commit()
                await state.consumer.commit()
            elif event_type == APPEAL_CREATED_V1:
                appeal = AppealCreated.model_validate(data)
                stmt = insert(AppealInbox).values(
                    appeal_id=appeal.appeal_id,
                    transaction_id=appeal.transaction_id,
                    reason_for_appeal=appeal.reason_for_appeal,
                    status="PENDING",
                    created_at=now,
                    updated_at=now,
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=[AppealInbox.appeal_id],
                    set_={
                        "transaction_id": appeal.transaction_id,
                        "reason_for_appeal": appeal.reason_for_appeal,
                        "status": "PENDING",
                        "updated_at": now,
                    },
                )
                await session.execute(stmt)
                await session.commit()
                await state.consumer.commit()


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
        topics=[settings.topic_transaction_flagged, settings.topic_appeal_created],
        group_id="fraud-review",
        bootstrap_servers=settings.kafka_bootstrap_servers,
        enable_auto_commit=False,
    )
    state.consumer_task = asyncio.create_task(_consume_cases())
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


app = FastAPI(title="Process Flagged & Appeals", version="0.1.0", lifespan=lifespan)

@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/login")
async def analyst_login(body: dict[str, Any]) -> dict[str, str]:
    if body.get("username") != _ANALYST_USERNAME or body.get("password") != _ANALYST_PASSWORD:
        raise HTTPException(status_code=401, detail="invalid credentials")
    return {"access_token": _make_analyst_token(), "token_type": "bearer"}


@app.get("/flagged")
async def list_flagged(_: str = Depends(_require_analyst)) -> list[dict[str, Any]]:
    assert state.sessionmaker is not None
    async with state.sessionmaker() as session:
        result = await session.execute(select(FlaggedCase).order_by(FlaggedCase.updated_at.desc()))
        rows = result.scalars().all()
    return [
        {
            "transaction_id": r.transaction_id,
            "rules_score": r.rules_score,
            "reason": r.reason,
            "status": r.status,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        }
        for r in rows
    ]


@app.post("/flagged/{transaction_id}/resolve")
async def resolve_flagged(transaction_id: str, request: dict[str, Any], _: str = Depends(_require_analyst)) -> dict[str, str]:
    try:
        manual_outcome = ManualOutcome(request["manual_outcome"])
        reason = str(request["reason"])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid request")

    reviewed = TransactionReviewed(transaction_id=transaction_id, manual_outcome=manual_outcome, reason=reason)
    payload = envelope(event_type=TRANSACTION_REVIEWED_V1, data=reviewed, trace_id=transaction_id)
    assert state.producer is not None
    await state.producer.send_and_wait(settings.topic_transaction_reviewed, payload)

    assert state.sessionmaker is not None
    async with state.sessionmaker() as session:
        result = await session.execute(
            select(FlaggedCase).where(FlaggedCase.transaction_id == transaction_id)
        )
        flagged = result.scalar_one_or_none()
        if flagged is not None:
            flagged.status = "RESOLVED"
            flagged.updated_at = utc_now()
            await session.commit()
    return {"status": "submitted"}


@app.get("/appeals")
async def list_appeals(_: str = Depends(_require_analyst)) -> list[dict[str, Any]]:
    assert state.sessionmaker is not None
    async with state.sessionmaker() as session:
        result = await session.execute(select(AppealInbox).order_by(AppealInbox.updated_at.desc()))
        rows = result.scalars().all()
    return [
        {
            "appeal_id": r.appeal_id,
            "transaction_id": r.transaction_id,
            "reason_for_appeal": r.reason_for_appeal,
            "status": r.status,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        }
        for r in rows
    ]


@app.post("/appeals/{appeal_id}/resolve")
async def resolve_appeal(appeal_id: str, request: dict[str, Any], _: str = Depends(_require_analyst)) -> dict[str, str]:
    assert state.sessionmaker is not None
    async with state.sessionmaker() as session:
        result = await session.execute(select(AppealInbox).where(AppealInbox.appeal_id == appeal_id))
        appeal = result.scalar_one_or_none()
    if appeal is None:
        raise HTTPException(status_code=404, detail="appeal not found")

    try:
        manual_outcome = ManualOutcome(request["manual_outcome"])
        outcome_reason = str(request["outcome_reason"])
    except Exception:
        raise HTTPException(status_code=400, detail="invalid request")

    resolved = AppealResolved(
        appeal_id=appeal_id,
        transaction_id=appeal.transaction_id,
        manual_outcome=manual_outcome,
        outcome_reason=outcome_reason,
    )
    payload = envelope(event_type=APPEAL_RESOLVED_V1, data=resolved, trace_id=appeal.transaction_id)
    assert state.producer is not None
    await state.producer.send_and_wait(settings.topic_appeal_resolved, payload)

    async with state.sessionmaker() as session:
        result = await session.execute(select(AppealInbox).where(AppealInbox.appeal_id == appeal_id))
        model = result.scalar_one_or_none()
        if model is not None:
            model.status = "RESOLVED"
            model.updated_at = utc_now()
            await session.commit()
    return {"status": "submitted"}
