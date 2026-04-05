from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from services.transaction.src.state import state

router = APIRouter()


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
