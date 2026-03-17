# Analytics Service

**Type:** Atomic Microservice
**Port:** None (Kafka worker only)
**Tech:** Python, aiokafka

---

## Responsibility

Tracks **real-time dashboard metrics** by consuming Kafka events and maintaining in-memory counters. After each event it logs a full metrics snapshot to stdout. In production this would push metrics to a time-series store (e.g. Prometheus, InfluxDB) or a BI dashboard.

---

## Kafka Events Consumed

| Topic | Metric updated |
|---|---|
| `transaction.flagged` | `transactions_flagged` |
| `transaction.finalised` (APPROVED) | `transactions_approved`, `total_approved_amount` |
| `transaction.finalised` (REJECTED) | `transactions_rejected`, `total_rejected_amount` |
| `transaction.reviewed` | `transactions_reviewed` |
| `appeal.created` | `appeals_created` |
| `appeal.resolved` (APPROVED) | `appeals_approved` |
| `appeal.resolved` (REJECTED) | `appeals_rejected` |

---

## Metrics Dashboard

After every event, a full snapshot is printed as JSON:

```json
{
  "updated_at": "2026-03-17T12:34:56.789+00:00",
  "transactions_approved": 142,
  "transactions_rejected": 18,
  "transactions_flagged": 7,
  "transactions_reviewed": 5,
  "appeals_created": 3,
  "appeals_approved": 2,
  "appeals_rejected": 1,
  "total_approved_amount": 54320.50,
  "total_rejected_amount": 8215.00
}
```

> Note: Metrics are in-memory only and reset when the container restarts. This is acceptable for the current MVP scope.

---

## Environment Variables

| Variable | Description |
|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
