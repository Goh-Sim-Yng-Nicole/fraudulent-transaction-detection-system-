# Appeal Service

**Type:** Atomic Microservice
**Port:** 8003
**Tech:** Python, FastAPI, SQLAlchemy (asyncpg), PostgreSQL, aiokafka

---

## Responsibility

Handles the customer-facing appeal workflow. When a customer contests a rejected or flagged transaction, they submit an appeal here. The service persists the appeal, publishes `appeal.created` to Kafka (so the fraud review team can pick it up), and later updates the appeal record when `appeal.resolved` is received.

---

## Kafka

| Direction | Topic | Action |
|---|---|---|
| Publishes | `appeal.created` | After a new appeal is stored |
| Consumes | `appeal.resolved` | Updates the local appeal record with the analyst's decision |

---

## HTTP API

| Method | Path | Description |
|---|---|---|
| `POST` | `/appeals` | Submit a new appeal |
| `GET` | `/appeals/{appeal_id}` | Get appeal status and resolution details |

### Submit an appeal

```json
POST /appeals
{
  "transaction_id": "...",
  "reason_for_appeal": "This transaction was not made by me."
}
```

Returns:
```json
{ "appeal_id": "...", "status": "PENDING" }
```

### Get appeal status

Returns full details including resolution once resolved:

```json
{
  "appeal": {
    "appeal_id": "...",
    "transaction_id": "...",
    "reason_for_appeal": "..."
  },
  "status": "RESOLVED",
  "resolution": {
    "manual_outcome": "APPROVED",
    "outcome_reason": "Verified legitimate transaction"
  }
}
```

---

## Data Model

**Appeal** (`appeals` table):

| Field | Description |
|---|---|
| `appeal_id` | UUID PK |
| `transaction_id` | Related transaction |
| `reason_for_appeal` | Customer's stated reason |
| `status` | `PENDING` → `RESOLVED` |
| `manual_outcome` | `APPROVED` or `REJECTED` (set on resolution) |
| `outcome_reason` | Analyst's reason (set on resolution) |

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
