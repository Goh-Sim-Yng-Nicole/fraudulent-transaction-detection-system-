# Fraud Score Service

**Type:** Atomic Microservice
**Port:** 8001
**Tech:** Node.js, Express, scikit-learn (via pre-trained model file)

---

## Responsibility

Accepts a transaction payload and returns a fraud probability score. The score is produced by a pre-trained machine learning model (loaded from `models/`) with rule-based fallback logic. This service has **no Kafka dependency** — it is called synchronously over HTTP by the Detect Fraud composite service.

---

## Key Endpoint

| Method | Path | Description |
|---|---|---|
| `POST` | `/score` | Score a transaction |

### Request Body

```json
{
  "transaction_id": "abc-123",
  "amount": 1500.00,
  "currency": "SGD",
  "card_type": "CREDIT",
  "country": "SG",
  "merchant_id": "grab_sg",
  "hour_utc": 14,
  "velocity_txn_hour_raw": 3,
  "geo_country_high_risk": false
}
```

### Response

```json
{
  "transaction_id": "abc-123",
  "fraud_probability": 0.23,
  "rules_score": 23
}
```

`rules_score` is the probability scaled to 0–100. The Decision service uses this value against the configured thresholds (`APPROVE_MAX_SCORE`, `FLAG_MAX_SCORE`).

---

## Model Training

The ML model is trained offline on `data/synthetic_training_full.csv` using:

```bash
node scripts/trainOfflineModel.js
```

The trained model artifact is saved to `models/`. The service loads it on startup and serves predictions in-process.

---

## Features Used by the Model

- `amount`
- `currency`
- `card_type`
- `country`
- `hour_utc`
- `velocity_txn_hour_raw` (optional enrichment)
- `geo_country_high_risk` (optional enrichment)

---

## Observability

- Prometheus metrics exposed (request count, latency) for scraping
- Swagger/OpenAPI docs available at `GET /docs` (or `/api-docs`)
- Correlation ID middleware for request tracing
