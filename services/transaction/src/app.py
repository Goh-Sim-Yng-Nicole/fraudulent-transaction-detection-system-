from __future__ import annotations

import asyncio
import contextlib
import json
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.coordinator.assignors.roundrobin import RoundRobinPartitionAssignor
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from services.transaction.src.config.settings import (
    CORRELATION_ID_HEADER,
    IDEMPOTENCY_KEY_HEADER,
    KAFKA_BOOTSTRAP_SERVERS,
    KAFKA_CLIENT_ID,
    KAFKA_GROUP_ID,
    REQUEST_ID_HEADER,
    SERVICE_VERSION,
    TOPIC_APPEAL_RESOLVED,
    TOPIC_TRANSACTION_FINALISED,
    TOPIC_TRANSACTION_FLAGGED,
    TOPIC_TRANSACTION_REVIEWED,
)
from services.transaction.src.consumers.transaction_consumer import (
    normalize_status_update,
    send_to_dlq,
)
from services.transaction.src.db.connection import (
    create_engine,
    create_sessionmaker,
    init_db,
    should_auto_create_tables,
    wait_for_db,
)
from services.transaction.src.repositories.transaction_repository import TransactionRepository
from services.transaction.src.routes.health import router as health_router
from services.transaction.src.routes.transaction_routes import router as transaction_router
from services.transaction.src.state import state
from services.transaction.src.utils.observability import (
    instrument_fastapi,
    instrument_sqlalchemy,
    shutdown_tracing,
)


class KafkaJSCompatibleRoundRobinAssignor(RoundRobinPartitionAssignor):
    name = "RoundRobinAssigner"


def _json_serializer(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")


async def _consume_status_updates() -> None:
    assert state.consumer is not None
    assert state.store is not None

    async for message in state.consumer:
        raw_bytes = message.value
        raw_payload = raw_bytes.decode("utf-8", errors="replace") if raw_bytes else None

        if not raw_payload:
            await send_to_dlq(
                state.producer,
                topic=message.topic, partition=message.partition,
                offset=message.offset, reason="empty_payload",
            )
            await state.consumer.commit()
            continue

        try:
            parsed_payload = json.loads(raw_payload)
        except json.JSONDecodeError as exc:
            await send_to_dlq(
                state.producer,
                topic=message.topic, partition=message.partition,
                offset=message.offset, reason="parse_error",
                raw_payload=raw_payload, error=str(exc),
            )
            await state.consumer.commit()
            continue

        update = normalize_status_update(message.topic, parsed_payload)
        if update is None:
            await send_to_dlq(
                state.producer,
                topic=message.topic, partition=message.partition,
                offset=message.offset, reason="invalid_event",
                raw_payload=raw_payload, parsed_payload=parsed_payload,
                error="Unable to derive a transaction status update from the event",
            )
            await state.consumer.commit()
            continue

        updated = await state.store.apply_status_update(
            transaction_id=update["transaction_id"],
            status=update["status"],
            fraud_score=update["fraud_score"],
            outcome_reason=update["outcome_reason"],
        )
        if updated is None:
            await send_to_dlq(
                state.producer,
                topic=message.topic, partition=message.partition,
                offset=message.offset, reason="unknown_transaction",
                raw_payload=raw_payload, parsed_payload=parsed_payload,
                error=f"Transaction {update['transaction_id']} was not found",
            )
        await state.consumer.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    database_url = os.getenv("DATABASE_URL", "").strip()
    state.engine = create_engine(database_url)
    instrument_sqlalchemy(state.engine)
    await wait_for_db(state.engine)
    if should_auto_create_tables():
        await init_db(state.engine)

    state.session_factory = create_sessionmaker(state.engine)
    state.store = TransactionRepository(state.session_factory)

    state.producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        value_serializer=_json_serializer,
        compression_type="gzip",
        acks="all",
        client_id=f"{KAFKA_CLIENT_ID}-producer",
    )
    await state.producer.start()

    state.consumer = AIOKafkaConsumer(
        TOPIC_TRANSACTION_FLAGGED,
        TOPIC_TRANSACTION_FINALISED,
        TOPIC_TRANSACTION_REVIEWED,
        TOPIC_APPEAL_RESOLVED,
        bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
        group_id=KAFKA_GROUP_ID,
        auto_offset_reset="latest",
        enable_auto_commit=False,
        client_id=f"{KAFKA_CLIENT_ID}-status-consumer",
        partition_assignment_strategy=(KafkaJSCompatibleRoundRobinAssignor,),
    )
    await state.consumer.start()
    state.consumer_task = asyncio.create_task(_consume_status_updates())

    try:
        yield
    finally:
        if state.consumer_task is not None:
            state.consumer_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await state.consumer_task
        if state.consumer is not None:
            await state.consumer.stop()
        if state.producer is not None:
            await state.producer.stop()
        if state.engine is not None:
            await state.engine.dispose()
        shutdown_tracing()


app = FastAPI(title="FTDS Transaction Service", version=SERVICE_VERSION, lifespan=lifespan)
instrument_fastapi(app)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
    correlation_id = request.headers.get(CORRELATION_ID_HEADER) or request_id
    idempotency_key = request.headers.get(IDEMPOTENCY_KEY_HEADER)

    request.state.request_id = request_id
    request.state.correlation_id = correlation_id
    request.state.idempotency_key = idempotency_key.strip() if idempotency_key else None

    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = request_id
    response.headers[CORRELATION_ID_HEADER] = correlation_id
    return response


@app.exception_handler(RequestValidationError)
async def request_validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    message = "; ".join(error.get("msg", "Invalid request") for error in exc.errors())
    return JSONResponse(status_code=400, content={"message": message or "Invalid request"})


app.include_router(health_router)
app.include_router(transaction_router)
app.include_router(transaction_router, prefix="/api/v1")
