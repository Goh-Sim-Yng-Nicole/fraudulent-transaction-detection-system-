# Analytics Service

Maintains in-memory dashboard metrics by consuming Kafka events. Prints a full JSON snapshot after every event. Metrics reset on service restart.

**Type:** Atomic microservice (Kafka worker only) | **Port:** None

---

## Kafka Events Consumed (5 topics)

| Topic | Metric updated |
|---|---|
| `transaction.flagged` | `transactions_flagged` |
| `transaction.finalised` | `transactions_approved` / `transactions_rejected`, `total_approved_amount` / `total_rejected_amount` |
| `transaction.reviewed` | `transactions_reviewed` |
| `appeal.created` | `appeals_created` |
| `appeal.resolved` | `appeals_approved` / `appeals_rejected` |

---

## Dashboard Snapshot

Printed as `[analytics] <JSON>` after every event:

```json
{
  "updated_at": "2026-03-18T10:00:00Z",
  "transactions_approved": 120,
  "transactions_rejected": 15,
  "transactions_flagged": 30,
  "transactions_reviewed": 28,
  "appeals_created": 10,
  "appeals_approved": 7,
  "appeals_rejected": 3,
  "total_approved_amount": 95000.00,
  "total_rejected_amount": 12500.00
}
```

---

## Manager Dashboard

The Manager Dashboard UI (`ui/manager.html`) reads these metrics via an HTTP endpoint exposed by this service.
