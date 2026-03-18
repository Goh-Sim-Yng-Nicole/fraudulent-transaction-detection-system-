# Process Flagged & Appeals Service

Composite service used by fraud review analysts to manually review flagged transactions and customer appeals. Consumes Kafka events to build its own DB view, and publishes resolution events.

**Port:** 8002 | **Type:** Composite service

---

## Authentication

All `/flagged` and `/appeals` endpoints require a Bearer JWT issued by `POST /login`.

| Variable | Default |
|---|---|
| `ANALYST_USERNAME` | `analyst` |
| `ANALYST_PASSWORD` | `analyst123` |
| `ANALYST_JWT_SECRET` | `analyst-dev-secret-change-in-prod` |

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/login` | None | Analyst login → JWT |
| `GET` | `/health` | None | Health check |
| `GET` | `/flagged` | JWT | List all flagged transaction cases |
| `POST` | `/flagged/{transaction_id}/resolve` | JWT | Resolve a flagged transaction |
| `GET` | `/appeals` | JWT | List all pending appeals |
| `POST` | `/appeals/{appeal_id}/resolve` | JWT | Resolve an appeal |

### Resolve Flagged body
```json
{ "manual_outcome": "APPROVED", "reason": "Verified with customer" }
```

### Resolve Appeal body
```json
{ "manual_outcome": "APPROVED", "outcome_reason": "Legitimate transaction confirmed" }
```

**`manual_outcome` values:** `APPROVED` / `REJECTED`

---

## Kafka

| Direction | Topic |
|---|---|
| Consumes | `transaction.flagged` |
| Consumes | `appeal.created` |
| Produces | `transaction.reviewed` (on flagged resolution) |
| Produces | `appeal.resolved` (on appeal resolution) |

---

## Data Model

**flagged_cases**
| Field | Notes |
|---|---|
| `transaction_id` | PK |
| `rules_score` | 0–100 |
| `reason` | Why it was flagged |
| `status` | FLAGGED → RESOLVED |

**appeal_inbox**
| Field | Notes |
|---|---|
| `appeal_id` | PK |
| `transaction_id` | Related transaction |
| `reason_for_appeal` | Customer's stated reason |
| `status` | PENDING → RESOLVED |
