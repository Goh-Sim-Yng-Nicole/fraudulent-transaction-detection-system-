# Detect Fraud Service

**Type:** Composite Service (orchestrator worker)
**Port:** None (Kafka worker only)
**Tech:** Python, aiokafka, httpx

---

## Responsibility

Orchestrates the fraud scoring step. It bridges the event-driven pipeline and the synchronous Fraud Score API:

1. Consumes `transaction.created` from Kafka
2. Calls the **Fraud Score Service** via HTTP (`POST /score`) with the transaction details
3. Converts the returned probability into a 0–100 integer score
4. Publishes `transaction.scored` to Kafka for the Decision service to act on

This is a **composite service** because it coordinates two protocols: Kafka (async events) and HTTP (sync RPC to Fraud Score).

---

## Kafka

| Direction | Topic | Event type |
|---|---|---|
| Consumes | `transaction.created` | `transaction.created.v1` |
| Publishes | `transaction.scored` | `transaction.scored.v1` |

---

## Score Conversion

The Fraud Score service may return either:
- `rules_score` (already 0–100) — used directly
- `fraud_probability` (0.0–1.0) — multiplied by 100 and rounded

---

## Environment Variables

| Variable | Description |
|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
| `FRAUD_SCORE_URL` | Full URL of the Fraud Score endpoint (default: `http://fraud-score:8001/score`) |
