# Detect Fraud Service

Composite service that orchestrates fraud scoring by consuming `transaction.created` events, calling the fraud_score HTTP API, and publishing `transaction.scored`.

**Type:** Composite service (Kafka worker + HTTP client) | **Port:** None

---

## Flow

```
transaction.created
  → fetch transaction details from transaction service
  → POST /score to fraud_score service
  → publish transaction.scored { transaction_id, rules_score }
```

---

## Kafka

| Direction | Topic |
|---|---|
| Consumes | `transaction.created` |
| Produces | `transaction.scored` |

---

## Environment Variables

| Variable | Description |
|---|---|
| `FRAUD_SCORE_URL` | URL of fraud_score `/score` endpoint (default `http://fraud-score:8001/score`) |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
