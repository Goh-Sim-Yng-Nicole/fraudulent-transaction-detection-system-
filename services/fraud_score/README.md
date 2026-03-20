# Fraud Score Service

Scores transactions using a pre-trained Random Forest model and returns a fraud risk score from 0 to 100.

**Port:** 8001  
**Type:** Atomic microservice (Node.js / Express)

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/score` | Score a transaction; returns `{ score: 0-100 }` |
| `POST` | `/api/v1/score` | Versioned alias for `/score` |
| `GET` | `/health` | Health check |
| `GET` | `/model` | Model metadata (algorithm, features, trained_at) |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/api-docs` | Swagger UI |
| `GET` | `/api-docs.json` | OpenAPI JSON spec |

---

## Score Request

```json
{
  "amount": 5000.0,
  "hour_of_day": 2,
  "is_foreign_transaction": false,
  "is_high_risk_merchant": false,
  "transaction_count_1h": 3,
  "avg_transaction_amount": 200.0,
  "geo_country_high_risk": false
}
```

---

## Score Response

```json
{ "score": 72 }
```

The score range is 0-100. The final decision thresholds are applied by OutSystems in production, or by the local `detect_fraud` fallback during Docker development and automated testing.

---

## Model

- **Algorithm:** Random Forest Classifier (scikit-learn, loaded via Python child process)
- **Features:** amount, hour_of_day, is_foreign_transaction, is_high_risk_merchant, transaction_count_1h, avg_transaction_amount, geo_country_high_risk
- Retrain by running the training script and replacing the model file
