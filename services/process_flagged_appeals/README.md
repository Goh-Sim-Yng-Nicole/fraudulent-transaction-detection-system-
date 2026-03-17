# Process Flagged & Appeals Service

**Type:** Composite Service
**Port:** 8002
**Tech:** Python, FastAPI, SQLAlchemy (asyncpg), PostgreSQL, aiokafka

---

## Responsibility

The backend for the **Fraud Review Team UI**. It combines an HTTP API (for the fraud analysts) with a Kafka consumer (to receive flagged cases and new appeals). When an analyst resolves a case or appeal, it publishes the outcome back to Kafka.

This is a **composite service** because it actively coordinates between:
- HTTP (serving the fraud review team UI)
- Kafka (receiving flagged transactions and appeals, publishing review outcomes)
- Its own PostgreSQL database (persisting cases and appeals for analyst queuing)

---

## Kafka

| Direction | Topic | Action |
|---|---|---|
| Consumes | `transaction.flagged` | Creates a `FlaggedCase` record for analyst review |
| Consumes | `appeal.created` | Creates an `AppealInbox` record for analyst review |
| Publishes | `transaction.reviewed` | After analyst resolves a flagged case |
| Publishes | `appeal.resolved` | After analyst resolves an appeal |

---

## HTTP API (Fraud Review Team)

### Flagged Cases

| Method | Path | Description |
|---|---|---|
| `GET` | `/flagged` | List all flagged cases (sorted by most recent) |
| `POST` | `/flagged/{transaction_id}/resolve` | Resolve a flagged case with manual outcome |

**Resolve request body:**
```json
{ "manual_outcome": "APPROVED", "reason": "Verified by analyst" }
```
`manual_outcome` must be `APPROVED` or `REJECTED`.

### Appeals

| Method | Path | Description |
|---|---|---|
| `GET` | `/appeals` | List all appeals (sorted by most recent) |
| `POST` | `/appeals/{appeal_id}/resolve` | Resolve an appeal with outcome and reason |

**Resolve request body:**
```json
{ "manual_outcome": "REJECTED", "outcome_reason": "Insufficient evidence" }
```

---

## Data Models

**FlaggedCase** (`flagged_cases` table):

| Field | Description |
|---|---|
| `transaction_id` | PK — links to Transaction service |
| `rules_score` | Fraud score that triggered flagging |
| `reason` | Reason string from Decision service |
| `status` | `FLAGGED` → `RESOLVED` |

**AppealInbox** (`appeal_inbox` table):

| Field | Description |
|---|---|
| `appeal_id` | PK — links to Appeal service |
| `transaction_id` | Related transaction |
| `reason_for_appeal` | Customer's stated reason |
| `status` | `PENDING` → `RESOLVED` |

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
