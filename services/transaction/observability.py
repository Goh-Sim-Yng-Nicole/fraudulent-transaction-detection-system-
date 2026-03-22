from __future__ import annotations

import os
from typing import Any

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from sqlalchemy.ext.asyncio import AsyncEngine

_tracer_provider: TracerProvider | None = None
_fastapi_instrumented = False
_sqlalchemy_instrumented = False


def _otel_enabled() -> bool:
    return os.getenv("OTEL_ENABLED", "true").strip().lower() == "true"


def _traces_endpoint() -> str:
    base_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318").rstrip("/")
    return os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", f"{base_endpoint}/v1/traces").strip()


def configure_tracing() -> TracerProvider | None:
    global _tracer_provider

    if not _otel_enabled():
        return None
    if _tracer_provider is not None:
        return _tracer_provider

    resource_attributes: dict[str, Any] = {
        "service.name": os.getenv("OTEL_SERVICE_NAME", "transaction").strip() or "transaction",
    }
    service_namespace = os.getenv("OTEL_SERVICE_NAMESPACE", "").strip()
    if service_namespace:
        resource_attributes["service.namespace"] = service_namespace

    provider = TracerProvider(resource=Resource.create(resource_attributes))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=_traces_endpoint())))
    trace.set_tracer_provider(provider)
    _tracer_provider = provider
    print(f"[tracing] OpenTelemetry started ({_traces_endpoint()})", flush=True)
    return provider


def instrument_fastapi(app: Any) -> None:
    global _fastapi_instrumented

    provider = configure_tracing()
    if provider is None or _fastapi_instrumented:
        return

    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    _fastapi_instrumented = True


def instrument_sqlalchemy(engine: AsyncEngine) -> None:
    global _sqlalchemy_instrumented

    provider = configure_tracing()
    if provider is None or _sqlalchemy_instrumented:
        return

    SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine, tracer_provider=provider)
    _sqlalchemy_instrumented = True


def shutdown_tracing() -> None:
    global _tracer_provider

    if _tracer_provider is None:
        return

    _tracer_provider.shutdown()
    _tracer_provider = None
