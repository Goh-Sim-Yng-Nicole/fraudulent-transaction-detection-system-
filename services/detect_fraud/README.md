# Detect Fraud Service

Composite service that consumes `transaction.created`, calls `fraud_score`, publishes `transaction.scored`, and coordinates the decision handoff to OutSystems. When no OutSystems decision endpoint is configured, it emits the final Kafka decision events locally so Docker development and automated tests remain fully end to end.

**Type:** Composite service (Kafka worker + HTTP client)  
**Port:** 8008

---

## Flow

```text
transaction.created
  -> POST /score to fraud_score
  -> publish transaction.scored
  -> POST scored payload to OutSystems (optional)
  -> if OutSystems is unset or unavailable and local fallback is enabled:
      -> publish transaction.flagged / transaction.finalised
```

---

## Kafka

| Direction | Topic |
|---|---|
| Consumes | `transaction.created` |
| Produces | `transaction.scored` |
| Produces | `transaction.flagged` / `transaction.finalised` (local fallback only) |

---

## Environment Variables

| Variable | Description |
|---|---|
| `FRAUD_SCORE_URL` | URL of the fraud score endpoint (default `http://fraud-score:8001/score`) |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
| `OUTSYSTEMS_DECISION_URL` | Optional HTTP endpoint used to hand off scored transactions for external decisioning |
| `ENABLE_LOCAL_DECISION_FALLBACK` | When `true`, emits final decision events locally if OutSystems is unavailable or unset |
