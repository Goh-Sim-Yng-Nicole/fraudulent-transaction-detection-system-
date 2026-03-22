from __future__ import annotations

import asyncio
import contextlib
import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.coordinator.assignors.roundrobin import RoundRobinPartitionAssignor
from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

from services.transaction.db import (
    create_engine,
    create_sessionmaker,
    init_db,
    should_auto_create_tables,
    wait_for_db,
)
from services.transaction.observability import (
    instrument_fastapi,
    instrument_sqlalchemy,
    shutdown_tracing,
)
from services.transaction.store import TransactionStore

REQUEST_ID_HEADER = "x-request-id"
CORRELATION_ID_HEADER = "x-correlation-id"
IDEMPOTENCY_KEY_HEADER = "x-idempotency-key"
SERVICE_NAME = os.getenv("SERVICE_NAME", "transaction").strip() or "transaction"
SERVICE_VERSION = os.getenv("SERVICE_VERSION", "2.0.0").strip() or "2.0.0"
KAFKA_BOOTSTRAP_SERVERS = (
    os.getenv("KAFKA_BROKERS")
    or os.getenv("KAFKA_BOOTSTRAP_SERVERS")
    or "localhost:9092"
).strip()
KAFKA_CLIENT_ID = os.getenv("KAFKA_CLIENT_ID", "transaction-service").strip() or "transaction-service"
KAFKA_GROUP_ID = os.getenv("KAFKA_GROUP_ID", "transaction-service").strip() or "transaction-service"
TOPIC_TRANSACTION_CREATED = (
    os.getenv("KAFKA_TOPIC_TRANSACTION_CREATED")
    or os.getenv("TOPIC_TRANSACTION_CREATED")
    or "transaction.created"
).strip()
TOPIC_TRANSACTION_FLAGGED = (
    os.getenv("KAFKA_TOPIC_TRANSACTION_FLAGGED")
    or os.getenv("TOPIC_TRANSACTION_FLAGGED")
    or "transaction.flagged"
).strip()
TOPIC_TRANSACTION_FINALISED = (
    os.getenv("KAFKA_TOPIC_TRANSACTION_FINALISED")
    or os.getenv("TOPIC_TRANSACTION_FINALISED")
    or "transaction.finalised"
).strip()
TOPIC_TRANSACTION_REVIEWED = (
    os.getenv("KAFKA_TOPIC_TRANSACTION_REVIEWED")
    or os.getenv("TOPIC_TRANSACTION_REVIEWED")
    or "transaction.reviewed"
).strip()
TOPIC_APPEAL_RESOLVED = (
    os.getenv("KAFKA_TOPIC_APPEAL_RESOLVED")
    or os.getenv("TOPIC_APPEAL_RESOLVED")
    or "appeal.resolved"
).strip()
TOPIC_TRANSACTION_DLQ = os.getenv("KAFKA_DLQ_TOPIC", "transaction.dlq").strip() or "transaction.dlq"


class TransactionCreateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    customer_id: str = Field(validation_alias=AliasChoices("customer_id", "customerId"))
    amount: float = Field(gt=0, le=1_000_000)
    currency: str = "SGD"
    card_type: str = Field(
        default="CREDIT",
        validation_alias=AliasChoices("card_type", "cardType"),
    )
    country: str
    merchant_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("merchant_id", "merchantId"),
    )
    sender_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices("sender_name", "senderName"),
    )
    recipient_customer_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("recipient_customer_id", "recipientCustomerId"),
    )
    recipient_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices("recipient_name", "recipientName"),
    )
    hour_utc: int | None = Field(
        default=None,
        ge=0,
        le=23,
        validation_alias=AliasChoices("hour_utc", "hourUtc"),
    )

    @field_validator("customer_id", "currency", "card_type", "country")
    @classmethod
    def _normalize_required_text(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("field cannot be blank")
        return normalized

    @field_validator("currency", "card_type", "country")
    @classmethod
    def _uppercase_text(cls, value: str) -> str:
        return value.upper()

    @field_validator("merchant_id", "sender_name", "recipient_customer_id", "recipient_name", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value: Any) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None


class AppState:
    def __init__(self) -> None:
        self.engine = None
        self.session_factory = None
        self.store: TransactionStore | None = None
        self.producer: AIOKafkaProducer | None = None
        self.consumer: AIOKafkaConsumer | None = None
        self.consumer_task = None


state = AppState()


class KafkaJSCompatibleRoundRobinAssignor(RoundRobinPartitionAssignor):
    name = "RoundRobinAssigner"


def _json_serializer(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")


def _bytes_header(name: str, value: str | None) -> tuple[str, bytes]:
    return (name, (value or "").encode("utf-8"))


def _as_int_or_none(*values: Any) -> int | None:
    for value in values:
        if value in (None, ""):
            continue
        try:
            return int(float(value))
        except (TypeError, ValueError):
            continue
    return None


def _as_text_or_none(*values: Any) -> str | None:
    for value in values:
        if value is None:
            continue
        normalized = str(value).strip()
        if normalized:
            return normalized
    return None


def _serialize_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        **record,
        "created_at": record["created_at"].isoformat() if record.get("created_at") else None,
        "updated_at": record["updated_at"].isoformat() if record.get("updated_at") else None,
        "direction": record.get("direction"),
    }


def _to_fraud_transaction(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record["transaction_id"],
        "customerId": record["customer_id"],
        "merchantId": record["merchant_id"],
        "amount": float(record["amount"]),
        "currency": record["currency"],
        "cardType": record["card_type"],
        "createdAt": record["created_at"].isoformat(),
        "location": {
            "country": record["country"],
        },
        "metadata": {
            "senderName": record["sender_name"],
            "recipientCustomerId": record["recipient_customer_id"],
            "recipientName": record["recipient_name"],
            "hourUtc": record["hour_utc"],
        },
    }


async def _publish_transaction_created(record: dict[str, Any], correlation_id: str) -> None:
    if state.producer is None:
        raise RuntimeError("Transaction producer is not ready")

    payload = {
        "eventType": "transaction.created",
        "event_type": "transaction.created.v1",
        "trace_id": record["transaction_id"],
        "correlationId": correlation_id,
        "transactionId": record["transaction_id"],
        "customerId": record["customer_id"],
        "merchantId": record["merchant_id"],
        "transaction": _to_fraud_transaction(record),
        "data": {
            "transaction_id": record["transaction_id"],
            "amount": record["amount"],
            "currency": record["currency"],
            "card_type": record["card_type"],
            "country": record["country"],
            "merchant_id": record["merchant_id"],
            "hour_utc": record["hour_utc"],
            "customer_id": record["customer_id"],
            "sender_name": record["sender_name"],
            "recipient_customer_id": record["recipient_customer_id"],
            "recipient_name": record["recipient_name"],
        },
        "createdAt": record["created_at"].isoformat(),
    }

    await state.producer.send_and_wait(
        TOPIC_TRANSACTION_CREATED,
        key=str(record["customer_id"]).encode("utf-8"),
        value=payload,
        headers=[
            _bytes_header("content-type", "application/json"),
            _bytes_header("service-source", SERVICE_NAME),
            _bytes_header("x-correlation-id", correlation_id),
        ],
    )


def _normalize_status_update(topic: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    transaction_id = (
        payload.get("transactionId")
        or payload.get("transaction_id")
        or data.get("transaction_id")
        or data.get("transactionId")
    )
    if not transaction_id:
        return None

    if topic == TOPIC_TRANSACTION_FLAGGED:
        return {
            "transaction_id": transaction_id,
            "status": "FLAGGED",
            "fraud_score": _as_int_or_none(
                payload.get("fraudAnalysis", {}).get("riskScore"),
                payload.get("rules_score"),
                data.get("rules_score"),
            ),
            "outcome_reason": _as_text_or_none(
                payload.get("decisionReason"),
                payload.get("reason"),
                data.get("reason"),
                "Transaction flagged for manual review",
            ),
        }

    if topic == TOPIC_TRANSACTION_FINALISED:
        outcome = _as_text_or_none(payload.get("decision"), payload.get("outcome"), data.get("outcome"))
        if not outcome:
            return None
        return {
            "transaction_id": transaction_id,
            "status": "APPROVED" if outcome.upper() == "APPROVED" else "REJECTED",
            "fraud_score": _as_int_or_none(
                payload.get("fraudAnalysis", {}).get("riskScore"),
                payload.get("rules_score"),
                data.get("rules_score"),
            ),
            "outcome_reason": _as_text_or_none(
                payload.get("decisionReason"),
                payload.get("reason"),
                data.get("reason"),
            ),
        }

    if topic == TOPIC_TRANSACTION_REVIEWED:
        review_decision = _as_text_or_none(
            payload.get("reviewDecision"),
            payload.get("decision"),
            payload.get("manual_outcome"),
            data.get("manual_outcome"),
        )
        if not review_decision:
            return None
        return {
            "transaction_id": transaction_id,
            "status": "APPROVED" if review_decision.upper() == "APPROVED" else "REJECTED",
            "fraud_score": _as_int_or_none(
                payload.get("fraudAnalysis", {}).get("riskScore"),
                payload.get("rules_score"),
                data.get("rules_score"),
            ),
            "outcome_reason": _as_text_or_none(
                payload.get("reviewNotes"),
                payload.get("reason"),
                data.get("reason"),
                "Manually reviewed",
            ),
        }

    if topic == TOPIC_APPEAL_RESOLVED:
        resolution = _as_text_or_none(
            payload.get("resolution"),
            payload.get("outcome"),
            data.get("manual_outcome"),
        )
        if not resolution:
            return None
        return {
            "transaction_id": transaction_id,
            "status": "APPROVED" if resolution.upper() in {"REVERSE", "APPROVED"} else "REJECTED",
            "fraud_score": _as_int_or_none(
                payload.get("fraudAnalysis", {}).get("riskScore"),
                payload.get("rules_score"),
                data.get("rules_score"),
            ),
            "outcome_reason": _as_text_or_none(
                payload.get("resolutionNotes"),
                payload.get("outcome_reason"),
                data.get("outcome_reason"),
                "Appeal resolved",
            ),
        }

    return None


async def _send_to_dlq(
    *,
    topic: str,
    partition: int,
    offset: int,
    reason: str,
    raw_payload: str | None = None,
    parsed_payload: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    if state.producer is None:
        raise RuntimeError("Transaction producer is not ready")

    key = (
        parsed_payload.get("transactionId")
        if parsed_payload
        else None
    ) or (
        parsed_payload.get("data", {}).get("transaction_id")
        if parsed_payload and isinstance(parsed_payload.get("data"), dict)
        else None
    ) or topic

    await state.producer.send_and_wait(
        TOPIC_TRANSACTION_DLQ,
        key=str(key).encode("utf-8"),
        value={
            "eventType": "transaction.dlq",
            "sourceTopic": topic,
            "sourcePartition": partition,
            "sourceOffset": offset,
            "reason": reason,
            "error": error,
            "rawPayload": raw_payload,
            "originalPayload": parsed_payload,
            "failedAt": datetime.now(timezone.utc).isoformat(),
            "serviceName": SERVICE_NAME,
        },
        headers=[
            _bytes_header("content-type", "application/json"),
            _bytes_header("service-source", SERVICE_NAME),
            _bytes_header("x-dlq-reason", reason),
        ],
    )


async def _consume_status_updates() -> None:
    assert state.consumer is not None
    assert state.store is not None

    async for message in state.consumer:
        raw_bytes = message.value
        raw_payload = raw_bytes.decode("utf-8", errors="replace") if raw_bytes else None

        if not raw_payload:
            await _send_to_dlq(
                topic=message.topic,
                partition=message.partition,
                offset=message.offset,
                reason="empty_payload",
            )
            await state.consumer.commit()
            continue

        try:
            parsed_payload = json.loads(raw_payload)
        except json.JSONDecodeError as exc:
            await _send_to_dlq(
                topic=message.topic,
                partition=message.partition,
                offset=message.offset,
                reason="parse_error",
                raw_payload=raw_payload,
                error=str(exc),
            )
            await state.consumer.commit()
            continue

        update = _normalize_status_update(message.topic, parsed_payload)
        if update is None:
            await _send_to_dlq(
                topic=message.topic,
                partition=message.partition,
                offset=message.offset,
                reason="invalid_event",
                raw_payload=raw_payload,
                parsed_payload=parsed_payload,
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
            await _send_to_dlq(
                topic=message.topic,
                partition=message.partition,
                offset=message.offset,
                reason="unknown_transaction",
                raw_payload=raw_payload,
                parsed_payload=parsed_payload,
                error=f"Transaction {update['transaction_id']} was not found",
            )
            await state.consumer.commit()
            continue

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
    state.store = TransactionStore(state.session_factory)

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


router = APIRouter()


@router.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@router.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


@router.get("/api-docs", include_in_schema=False)
async def api_docs() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@router.get("/api-docs.json", include_in_schema=False)
async def api_docs_json() -> JSONResponse:
    return JSONResponse(content=app.openapi())


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
async def health_ready() -> JSONResponse:
    if state.store is None:
        return JSONResponse(status_code=503, content={"status": "degraded", "detail": "store not ready"})

    try:
        await state.store.ping()
    except Exception as exc:
        return JSONResponse(status_code=503, content={"status": "degraded", "detail": str(exc)})

    return JSONResponse(content={"status": "ok"})


@router.post("/transactions", status_code=201)
async def create_transaction(payload: TransactionCreateRequest, request: Request) -> dict[str, Any]:
    assert state.store is not None

    normalized = payload.model_dump()
    if normalized["hour_utc"] is None:
        normalized["hour_utc"] = datetime.now(timezone.utc).hour
    if not normalized.get("merchant_id"):
        normalized["merchant_id"] = "FTDS_TRANSFER"

    idempotency_key = request.state.idempotency_key
    correlation_id = request.state.correlation_id
    request_id = request.state.request_id

    if idempotency_key:
        existing = await state.store.find_by_idempotency_key(
            idempotency_key,
            include_workflow_state=True,
        )
        if existing is not None:
            if existing["outbound_event_published_at"] is None:
                existing_correlation_id = existing.get("correlation_id") or correlation_id
                try:
                    await _publish_transaction_created(existing, existing_correlation_id)
                    updated = await state.store.mark_outbound_event_published(existing["transaction_id"])
                    if updated is None:
                        raise RuntimeError("Failed to reload transaction after publish")
                    return _serialize_record(updated)
                except Exception as exc:
                    await state.store.mark_outbound_event_failed(existing["transaction_id"], str(exc))
                    raise

            canonical = await state.store.find_by_id(existing["transaction_id"])
            if canonical is None:
                raise HTTPException(status_code=404, detail="transaction not found")
            return _serialize_record(canonical)

    record = await state.store.create(
        normalized,
        idempotency_key=idempotency_key,
        correlation_id=correlation_id,
        request_id=request_id,
    )

    try:
        await _publish_transaction_created(record, correlation_id)
        updated = await state.store.mark_outbound_event_published(record["transaction_id"])
        if updated is None:
            raise RuntimeError("Failed to reload transaction after publish")
        return _serialize_record(updated)
    except Exception as exc:
        await state.store.mark_outbound_event_failed(record["transaction_id"], str(exc))
        raise


@router.get("/transactions")
async def list_transactions(
    request: Request,
    direction: str = Query("all"),
) -> list[dict[str, Any]]:
    if direction not in {"all", "outgoing", "incoming"}:
        raise HTTPException(status_code=400, detail="direction must be all, outgoing, or incoming")

    customer_id = request.query_params.get("customer_id") or request.query_params.get("customerId")
    if not customer_id:
        raise HTTPException(status_code=400, detail="customer_id is required")

    assert state.store is not None
    records = await state.store.list_by_customer(customer_id, direction)
    return [_serialize_record(record) for record in records]


@router.get("/transactions/customer/{customer_id}")
async def list_transactions_by_customer(
    customer_id: str,
    direction: str = Query("all"),
) -> list[dict[str, Any]]:
    if direction not in {"all", "outgoing", "incoming"}:
        raise HTTPException(status_code=400, detail="direction must be all, outgoing, or incoming")

    assert state.store is not None
    records = await state.store.list_by_customer(customer_id, direction)
    return [_serialize_record(record) for record in records]


@router.get("/transactions/{transaction_id}")
async def get_transaction(transaction_id: str) -> dict[str, Any]:
    assert state.store is not None
    record = await state.store.find_by_id(transaction_id)
    if record is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return _serialize_record(record)


@router.get("/transactions/{transaction_id}/decision")
async def get_transaction_decision(transaction_id: str) -> dict[str, Any]:
    assert state.store is not None
    record = await state.store.find_by_id(transaction_id)
    if record is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    return {
        "transaction_id": record["transaction_id"],
        "status": record["status"],
        "fraud_score": record["fraud_score"],
        "outcome_reason": record["outcome_reason"],
        "updated_at": record["updated_at"].isoformat() if record.get("updated_at") else None,
    }


app.include_router(router)
app.include_router(router, prefix="/api/v1")
