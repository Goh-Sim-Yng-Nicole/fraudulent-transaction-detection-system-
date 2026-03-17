from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import RedirectResponse, Response

from ftds.schemas import FraudScoreRequest


app = FastAPI(title="Fraud Score Service", version="0.1.0")

@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/docs")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/score")
async def score(request: FraudScoreRequest) -> dict[str, int]:
    score = 0
    if request.amount >= 1000:
        score += 35
    elif request.amount >= 250:
        score += 15

    if request.country.upper() not in {"US", "SG"}:
        score += 20

    if request.card_type.upper() in {"PREPAID"}:
        score += 15

    if request.hour_utc <= 5 or request.hour_utc >= 23:
        score += 10

    if request.geo_country_high_risk:
        score += 20

    if request.velocity_txn_hour_raw is not None and request.velocity_txn_hour_raw >= 5:
        score += 10

    score = max(0, min(100, score))
    return {"rules_score": score}
