# Audit Service

**Type:** Atomic Microservice
**Port:** None (Kafka worker only)
**Tech:** Python, aiokafka

---

## Responsibility

Maintains an **immutable audit trail** by consuming every significant Kafka event and logging a structured JSON entry to stdout. In production this output would be shipped to a log aggregator (e.g. ELK, Splunk, CloudWatch).

The audit service consumes every event in the system — including transaction creation, scoring, flagging, finalisation, manual review, and appeal lifecycle — ensuring a complete, chronological record of all activity.

---

## Kafka Events Consumed

| Topic | Summary logged |
|---|---|
| `transaction.created` | Transaction submitted (amount, currency, country) |
| `transaction.scored` | Fraud score assigned (score) |
| `transaction.flagged` | Transaction flagged for review (score, reason) |
| `transaction.finalised` | Transaction finalised (outcome, score, reason) |
| `transaction.reviewed` | Manual review complete (outcome, reason) |
| `appeal.created` | Appeal submitted (appeal_id, reason) |
| `appeal.resolved` | Appeal resolved (outcome, reason) |

---

## Log Format

Each audit entry is a single-line JSON object:

```json
{
  "audit_at": "2026-03-17T12:34:56.789+00:00",
  "event_type": "transaction.finalised.v1",
  "summary": "Transaction finalised: REJECTED",
  "transaction_id": "b654538d-25a6-4851-96c7-d876d9ce0fc2",
  "outcome": "REJECTED",
  "rules_score": 85,
  "reason": "score=85 > 70"
}
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
