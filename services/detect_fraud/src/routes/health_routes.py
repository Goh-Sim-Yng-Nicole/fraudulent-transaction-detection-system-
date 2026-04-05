from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse, RedirectResponse, Response

from services.detect_fraud.src.config.settings import settings
from services.detect_fraud.src.state import state

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


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "decisionIntegrationMode": settings.decision_integration_mode}


@router.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "ok", "decisionIntegrationMode": settings.decision_integration_mode}


@router.get("/health/ready")
async def health_ready() -> JSONResponse:
    if state.ready:
        return JSONResponse(content={"status": "ok", "decisionIntegrationMode": settings.decision_integration_mode})

    detail = str(state.processing_error) if state.processing_error else "consumer not ready"
    return JSONResponse(
        status_code=503,
        content={"status": "degraded", "detail": detail, "decisionIntegrationMode": settings.decision_integration_mode},
    )
