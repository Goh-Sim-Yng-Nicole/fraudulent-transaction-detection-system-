from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse, Response


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return (value if value is not None else default).strip()


class Downstreams:
    def __init__(self) -> None:
        self.transaction_base = _env("TRANSACTION_BASE_URL", "http://localhost:8000")
        self.fraud_review_base = _env("FRAUD_REVIEW_BASE_URL", "http://localhost:8002")
        self.appeal_base = _env("APPEAL_BASE_URL", "http://localhost:8003")
        self.customer_base = _env("CUSTOMER_BASE_URL", "http://localhost:8005")


class AppState:
    def __init__(self) -> None:
        self.downstreams = Downstreams()
        self.client: httpx.AsyncClient | None = None


state = AppState()


@asynccontextmanager
async def lifespan(app: FastAPI):
    state.client = httpx.AsyncClient(timeout=15.0)
    try:
        yield
    finally:
        if state.client is not None:
            await state.client.aclose()


app = FastAPI(title="FTDS Gateway (Composite Service)", version="0.1.0", lifespan=lifespan)


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


async def _proxy(
    method: str,
    url: str,
    *,
    json_body: Any | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    assert state.client is not None
    try:
        resp = await state.client.request(method, url, json=json_body, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"downstream error: {exc}") from exc
    if resp.status_code >= 400:
        detail: Any
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise HTTPException(status_code=resp.status_code, detail=detail)
    if not resp.content:
        return None
    try:
        return resp.json()
    except Exception:
        return resp.text


# Customer auth + profile (proxied to customer service)
@app.post("/auth/register")
async def proxy_register(payload: dict[str, Any]) -> Any:
    return await _proxy("POST", f"{state.downstreams.customer_base}/register", json_body=payload)


@app.post("/auth/login")
async def proxy_login(payload: dict[str, Any]) -> Any:
    return await _proxy("POST", f"{state.downstreams.customer_base}/login", json_body=payload)


@app.get("/customers/me")
async def proxy_get_me(request: Request) -> Any:
    auth = request.headers.get("Authorization")
    hdrs = {"Authorization": auth} if auth else None
    return await _proxy("GET", f"{state.downstreams.customer_base}/me", headers=hdrs)


@app.put("/customers/me")
async def proxy_update_me(payload: dict[str, Any], request: Request) -> Any:
    auth = request.headers.get("Authorization")
    hdrs = {"Authorization": auth} if auth else None
    return await _proxy("PUT", f"{state.downstreams.customer_base}/me", json_body=payload, headers=hdrs)


# Customer Banking UI (composite)
@app.get("/customer/transactions")
async def customer_list_transactions(customer_id: str) -> Any:
    url = f"{state.downstreams.transaction_base}/transactions?customer_id={customer_id}"
    return await _proxy("GET", url)


@app.post("/customer/transactions")
async def customer_create_transaction(payload: dict[str, Any]) -> Any:
    url = f"{state.downstreams.transaction_base}/transactions"
    return await _proxy("POST", url, json_body=payload)


@app.get("/customer/transactions/{transaction_id}")
async def customer_get_transaction(transaction_id: str) -> Any:
    url = f"{state.downstreams.transaction_base}/transactions/{transaction_id}"
    return await _proxy("GET", url)


@app.get("/customer/transactions/{transaction_id}/decision")
async def customer_get_decision(transaction_id: str) -> Any:
    url = f"{state.downstreams.transaction_base}/transactions/{transaction_id}/decision"
    return await _proxy("GET", url)


@app.post("/customer/appeals")
async def customer_create_appeal(payload: dict[str, Any]) -> Any:
    url = f"{state.downstreams.appeal_base}/appeals"
    return await _proxy("POST", url, json_body=payload)


@app.get("/customer/appeals/{appeal_id}")
async def customer_get_appeal(appeal_id: str) -> Any:
    url = f"{state.downstreams.appeal_base}/appeals/{appeal_id}"
    return await _proxy("GET", url)


# Fraud Review Team UI (composite)
@app.get("/fraud/flagged")
async def fraud_list_flagged() -> Any:
    url = f"{state.downstreams.fraud_review_base}/flagged"
    return await _proxy("GET", url)


@app.post("/fraud/flagged/{transaction_id}/resolve")
async def fraud_resolve_flagged(transaction_id: str, payload: dict[str, Any]) -> Any:
    url = f"{state.downstreams.fraud_review_base}/flagged/{transaction_id}/resolve"
    return await _proxy("POST", url, json_body=payload)


@app.get("/fraud/appeals")
async def fraud_list_appeals() -> Any:
    url = f"{state.downstreams.fraud_review_base}/appeals"
    return await _proxy("GET", url)


@app.post("/fraud/appeals/{appeal_id}/resolve")
async def fraud_resolve_appeal(appeal_id: str, payload: dict[str, Any]) -> Any:
    url = f"{state.downstreams.fraud_review_base}/appeals/{appeal_id}/resolve"
    return await _proxy("POST", url, json_body=payload)

