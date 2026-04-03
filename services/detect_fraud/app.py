from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import httpx
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.coordinator.assignors.roundrobin import RoundRobinPartitionAssignor
from fastapi import APIRouter, FastAPI
from fastapi.responses import JSONResponse, RedirectResponse, Response

from services.detect_fraud.config import decision_mode_uses_local_decisioning, settings
from services.detect_fraud.decision_publisher import DecisionPublisher
from services.detect_fraud.fraud_detection_service import FraudDetectionService
from services.detect_fraud.ml_scoring_client import MlScoringClient
from services.detect_fraud.observability import instrument_fastapi, shutdown_tracing
from services.detect_fraud.rules_engine import FraudRulesEngine
from services.detect_fraud.velocity_store import VelocityStore

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("detect_fraud")


class KafkaJSCompatibleRoundRobinAssignor(RoundRobinPartitionAssignor):
    name = "RoundRobinAssigner"


def _json_serializer(value: Any) -> bytes:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")


def _header(name: str, value: str | None) -> tuple[str, bytes]:
    return (name, (value or "").encode("utf-8"))


def _normalize_transaction(payload: dict[str, Any]) -> dict[str, Any]:
    raw = payload.get("transaction") or payload.get("originalTransaction") or payload.get("data") or payload
    metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    created_at = raw.get("createdAt") or payload.get("createdAt") or datetime.now(timezone.utc).isoformat()

    return {
        "id": raw.get("id") or raw.get("transactionId") or raw.get("transaction_id"),
        "customerId": raw.get("customerId")
        or raw.get("customer_id")
        or payload.get("customerId")
        or payload.get("customer_id"),
        "merchantId": raw.get("merchantId")
        or raw.get("merchant_id")
        or payload.get("merchantId")
        or payload.get("merchant_id")
        or "FTDS_TRANSFER",
        "amount": float(raw.get("amount")) if raw.get("amount") is not None else float("nan"),
        "currency": raw.get("currency") or "SGD",
        "cardType": raw.get("cardType") or raw.get("card_type") or "CREDIT",
        "createdAt": created_at,
        "location": raw.get("location") or {"country": raw.get("country") or "SG"},
        "metadata": metadata,
    }


def _validate_transaction(transaction: dict[str, Any]) -> str | None:
    if not transaction.get("id"):
        return "transaction.id is required"
    if not transaction.get("customerId"):
        return "transaction.customerId is required"
    amount = transaction.get("amount")
    if not isinstance(amount, (int, float)) or not math.isfinite(float(amount)):
        return "transaction.amount must be a finite number"
    return None


class RuntimeState:
    def __init__(self) -> None:
        self.producer: AIOKafkaProducer | None = None
        self.consumer: AIOKafkaConsumer | None = None
        self.consumer_task: asyncio.Task[None] | None = None
        self.http_client: httpx.AsyncClient | None = None
        self.velocity_store: VelocityStore | None = None
        self.fraud_detection_service: FraudDetectionService | None = None
        self.decision_publisher: DecisionPublisher | None = None
        self.processing_error: Exception | None = None

    @property
    def ready(self) -> bool:
        if self.processing_error is not None:
            return False
        if self.producer is None or self.consumer is None or self.consumer_task is None:
            return False
        return not self.consumer_task.done()


state = RuntimeState()


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
        raise RuntimeError("Detect fraud DLQ producer is not ready")

    key = (
        parsed_payload.get("transactionId")
        if parsed_payload
        else None
    ) or (
        parsed_payload.get("transaction", {}).get("id")
        if parsed_payload and isinstance(parsed_payload.get("transaction"), dict)
        else None
    ) or topic

    await state.producer.send_and_wait(
        settings.kafka_dlq_topic,
        key=str(key).encode("utf-8"),
        value={
            "eventType": "detect-fraud.dlq",
            "sourceTopic": topic,
            "sourcePartition": partition,
            "sourceOffset": offset,
            "reason": reason,
            "error": error,
            "rawPayload": raw_payload,
            "originalPayload": parsed_payload,
            "failedAt": datetime.now(timezone.utc).isoformat(),
            "serviceName": settings.service_name,
        },
        headers=[
            _header("content-type", "application/json"),
            _header("service-source", settings.service_name),
            _header("x-dlq-reason", reason),
        ],
    )


async def _publish_scored_event(
    transaction: dict[str, Any],
    payload: dict[str, Any],
    fraud_analysis: dict[str, Any],
) -> None:
    if state.producer is None:
        raise RuntimeError("Detect fraud producer is not ready")

    await state.producer.send_and_wait(
        settings.kafka_output_topic,
        key=str(transaction["customerId"]).encode("utf-8"),
        value={
            "eventType": "transaction.scored",
            "transactionId": transaction["id"],
            "customerId": transaction["customerId"],
            "merchantId": transaction["merchantId"],
            "correlationId": payload.get("correlationId") or payload.get("trace_id") or transaction["id"],
            "originalTransaction": transaction,
            "fraudAnalysis": fraud_analysis,
            "data": {
                "transaction_id": transaction["id"],
                "rules_score": fraud_analysis["riskScore"],
                "reason": fraud_analysis["reasons"][0] if fraud_analysis["reasons"] else None,
            },
            "processedAt": datetime.now(timezone.utc).isoformat(),
        },
        headers=[
            _header("content-type", "application/json"),
            _header("service-source", settings.service_name),
        ],
    )


def _correlation_id_for(payload: dict[str, Any], transaction: dict[str, Any]) -> str:
    return payload.get("correlationId") or payload.get("trace_id") or transaction["id"]


def _should_publish_local_decision() -> bool:
    return decision_mode_uses_local_decisioning(settings.decision_integration_mode)


async def _handle_message(message: Any) -> None:
    raw_bytes = message.value
    raw_payload = raw_bytes.decode("utf-8", errors="replace") if raw_bytes else None

    if not raw_payload:
        logger.warning("Sending empty transaction.created event to DLQ")
        await _send_to_dlq(
            topic=message.topic,
            partition=message.partition,
            offset=message.offset,
            reason="empty_payload",
        )
        await state.consumer.commit()
        return

    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        logger.error("Sending malformed transaction.created event to DLQ: %s", exc)
        await _send_to_dlq(
            topic=message.topic,
            partition=message.partition,
            offset=message.offset,
            reason="parse_error",
            raw_payload=raw_payload,
            error=str(exc),
        )
        await state.consumer.commit()
        return

    transaction = _normalize_transaction(payload)
    validation_error = _validate_transaction(transaction)
    if validation_error is not None:
        logger.error("Sending invalid transaction.created event to DLQ: %s", validation_error)
        await _send_to_dlq(
            topic=message.topic,
            partition=message.partition,
            offset=message.offset,
            reason="invalid_event",
            raw_payload=raw_payload,
            parsed_payload=payload,
            error=validation_error,
        )
        await state.consumer.commit()
        return

    fraud_analysis = await state.fraud_detection_service.analyze_transaction(transaction)
    await _publish_scored_event(transaction, payload, fraud_analysis)
    if _should_publish_local_decision():
        await state.decision_publisher.process(
            producer=state.producer,
            transaction=transaction,
            fraud_analysis=fraud_analysis,
            correlation_id=_correlation_id_for(payload, transaction),
        )
    else:
        logger.info(
            "Published transaction.scored and deferred final decision to external Kafka consumer",
            extra={
                "transactionId": transaction["id"],
                "decisionIntegrationMode": settings.decision_integration_mode,
                "correlationId": _correlation_id_for(payload, transaction),
            },
        )
    await state.consumer.commit()


async def _consume_transactions() -> None:
    assert state.consumer is not None

    try:
        async for message in state.consumer:
            await _handle_message(message)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        state.processing_error = exc
        logger.exception("Fraud detection consumer failed to process transaction")
        raise


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state.processing_error = None
    state.velocity_store = VelocityStore()
    state.http_client = httpx.AsyncClient(timeout=settings.ml_scoring_timeout_ms / 1000)
    ml_scoring_client = MlScoringClient(state.http_client)
    rules_engine = FraudRulesEngine(state.velocity_store)
    state.fraud_detection_service = FraudDetectionService(rules_engine, ml_scoring_client)
    state.decision_publisher = DecisionPublisher(state.http_client)

    state.producer = AIOKafkaProducer(
        bootstrap_servers=settings.kafka_brokers,
        value_serializer=_json_serializer,
        compression_type="gzip",
        acks="all",
        enable_idempotence=True,
        client_id=f"{settings.kafka_client_id}-producer",
    )
    await state.producer.start()

    state.consumer = AIOKafkaConsumer(
        settings.kafka_input_topic,
        bootstrap_servers=settings.kafka_brokers,
        group_id=settings.kafka_group_id,
        auto_offset_reset="latest",
        enable_auto_commit=False,
        client_id=f"{settings.kafka_client_id}-consumer",
        partition_assignment_strategy=(KafkaJSCompatibleRoundRobinAssignor,),
    )
    await state.consumer.start()
    state.consumer_task = asyncio.create_task(_consume_transactions())

    try:
        yield
    finally:
        if state.consumer_task is not None:
            state.consumer_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await state.consumer_task
            state.consumer_task = None
        if state.consumer is not None:
            await state.consumer.stop()
            state.consumer = None
        if state.producer is not None:
            await state.producer.stop()
            state.producer = None
        if state.http_client is not None:
            await state.http_client.aclose()
            state.http_client = None
        if state.velocity_store is not None:
            await state.velocity_store.close()
            state.velocity_store = None
        state.fraud_detection_service = None
        state.decision_publisher = None
        shutdown_tracing()


app = FastAPI(title="FTDS Fraud Detection Service", version=settings.service_version, lifespan=lifespan)
instrument_fastapi(app)

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
    return {"status": "ok", "decisionIntegrationMode": settings.decision_integration_mode}


@router.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "ok", "decisionIntegrationMode": settings.decision_integration_mode}


@router.get("/health/ready")
async def health_ready() -> JSONResponse:
    if state.ready:
        return JSONResponse(
            content={
                "status": "ok",
                "decisionIntegrationMode": settings.decision_integration_mode,
            }
        )

    detail = str(state.processing_error) if state.processing_error else "consumer not ready"
    return JSONResponse(
        status_code=503,
        content={
            "status": "degraded",
            "detail": detail,
            "decisionIntegrationMode": settings.decision_integration_mode,
        },
    )


app.include_router(router)
app.include_router(router, prefix="/api/v1")
