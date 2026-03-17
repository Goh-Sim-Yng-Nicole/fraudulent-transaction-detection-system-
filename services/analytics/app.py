from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from jose import jwt as jose_jwt

from ftds.config import settings
from ftds.event_types import (
    APPEAL_CREATED_V1,
    APPEAL_RESOLVED_V1,
    TRANSACTION_FINALISED_V1,
    TRANSACTION_FLAGGED_V1,
    TRANSACTION_REVIEWED_V1,
)
from ftds.events import get_event_type
from ftds.kafka import create_consumer, stop_quietly

dashboard: dict[str, Any] = {
    "transactions_approved": 0,
    "transactions_rejected": 0,
    "transactions_flagged": 0,
    "transactions_reviewed": 0,
    "appeals_created": 0,
    "appeals_approved": 0,
    "appeals_rejected": 0,
    "total_approved_amount": 0.0,
    "total_rejected_amount": 0.0,
}

_MANAGER_JWT_SECRET = os.getenv("MANAGER_JWT_SECRET", "manager-dev-secret-change-in-prod")
_MANAGER_USERNAME   = os.getenv("MANAGER_USERNAME", "manager")
_MANAGER_PASSWORD   = os.getenv("MANAGER_PASSWORD", "manager123")

_bearer = HTTPBearer()


def _make_manager_token() -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    return jose_jwt.encode({"sub": "manager", "exp": exp}, _MANAGER_JWT_SECRET, algorithm="HS256")


def _require_manager(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    try:
        payload = jose_jwt.decode(creds.credentials, _MANAGER_JWT_SECRET, algorithms=["HS256"])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="invalid or expired token")


async def _kafka_worker(consumer: Any) -> None:
    try:
        async for message in consumer:
            value: Any = message.value
            et = get_event_type(value)
            d  = value.get("data", {}) if isinstance(value, dict) else {}

            if et == TRANSACTION_FLAGGED_V1:
                dashboard["transactions_flagged"] += 1
            elif et == TRANSACTION_FINALISED_V1:
                outcome = d.get("outcome", "")
                amount  = float(d.get("amount") or 0)
                if outcome == "APPROVED":
                    dashboard["transactions_approved"]   += 1
                    dashboard["total_approved_amount"]   += amount
                elif outcome == "REJECTED":
                    dashboard["transactions_rejected"]   += 1
                    dashboard["total_rejected_amount"]   += amount
            elif et == TRANSACTION_REVIEWED_V1:
                dashboard["transactions_reviewed"] += 1
            elif et == APPEAL_CREATED_V1:
                dashboard["appeals_created"] += 1
            elif et == APPEAL_RESOLVED_V1:
                outcome = d.get("manual_outcome", "")
                if outcome == "APPROVED":
                    dashboard["appeals_approved"] += 1
                elif outcome == "REJECTED":
                    dashboard["appeals_rejected"] += 1

            print(
                f"[analytics] {json.dumps({'updated_at': datetime.now(timezone.utc).isoformat(), **dashboard})}",
                flush=True,
            )
    finally:
        await stop_quietly(consumer)


_consumer_task: asyncio.Task[None] | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _consumer_task
    consumer = await create_consumer(
        topics=[
            settings.topic_transaction_flagged,
            settings.topic_transaction_finalised,
            settings.topic_transaction_reviewed,
            settings.topic_appeal_created,
            settings.topic_appeal_resolved,
        ],
        group_id="analytics",
        bootstrap_servers=settings.kafka_bootstrap_servers,
    )
    _consumer_task = asyncio.create_task(_kafka_worker(consumer))
    try:
        yield
    finally:
        if _consumer_task:
            _consumer_task.cancel()
        await stop_quietly(consumer)


app = FastAPI(title="Analytics", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/login")
async def manager_login(body: dict[str, Any]) -> dict[str, str]:
    if body.get("username") != _MANAGER_USERNAME or body.get("password") != _MANAGER_PASSWORD:
        raise HTTPException(status_code=401, detail="invalid credentials")
    return {"access_token": _make_manager_token(), "token_type": "bearer"}


@app.get("/dashboard")
async def get_dashboard(_: str = Depends(_require_manager)) -> dict[str, Any]:
    return {"updated_at": datetime.now(timezone.utc).isoformat(), **dashboard}
