# Appeal Service

Manages the customer appeal lifecycle — stores appeals, listens for resolutions from the fraud review team, and updates appeal status accordingly.

**Port:** 8003 | **Type:** Atomic microservice

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/appeals?customer_id=` | List all appeals for a customer |
| `POST` | `/appeals` | Submit a new appeal |
| `GET` | `/appeals/{appeal_id}` | Get a single appeal with resolution details |

### POST /appeals body
```json
{
  "transaction_id": "uuid",
  "reason_for_appeal": "This was a legitimate transaction.",
  "customer_id": "uuid"
}
```

### GET /appeals/{appeal_id} response (resolved)
```json
{
  "appeal": { "appeal_id": "...", "transaction_id": "...", "reason_for_appeal": "..." },
  "status": "RESOLVED",
  "resolution": { "manual_outcome": "APPROVED", "outcome_reason": "..." }
}
```

---

## Kafka

| Direction | Topic |
|---|---|
| Produces | `appeal.created` |
| Consumes | `appeal.resolved` → updates status + outcome in DB |

---

## Data Model

**appeals**
| Field | Notes |
|---|---|
| `appeal_id` | UUID PK |
| `transaction_id` | Related transaction UUID |
| `customer_id` | UUID of the customer who submitted (nullable for old records) |
| `reason_for_appeal` | Customer's explanation |
| `status` | PENDING → RESOLVED |
| `manual_outcome` | APPROVED / REJECTED (set on resolution) |
| `outcome_reason` | Analyst's explanation (set on resolution) |
