# Human Verification Service

Handles manual review of flagged transactions and analyst resolution of customer appeals.

**Port:** `3010` | **Runtime:** Node.js / Express | **Type:** Composite service (Kafka consumer + HTTP)

---

## Flow

```text
transaction.flagged (Kafka)
  -> store review item in manual_reviews table
  -> analyst claims case via API
  -> analyst resolves case via API
  -> publish transaction.reviewed (Kafka)
  -> forward appeal resolutions to Appeal Service (HTTP)
```

---

## Endpoints

### Review Cases

| Method | Path                                             | Auth   | Description                              |
| ------ | ------------------------------------------------ | ------ | ---------------------------------------- |
| `GET`  | `/api/v1/review-cases?status=PENDING,IN_REVIEW`  | Staff  | List review cases filtered by status     |
| `GET`  | `/api/v1/review-cases/:transactionId`            | Staff  | Get a single review case                 |
| `GET`  | `/api/v1/review-cases/:transactionId/history`    | Staff  | Get claim/release/resolve event history  |
| `POST` | `/api/v1/review-cases/:transactionId/claim`      | Staff  | Claim a case for review                  |
| `POST` | `/api/v1/review-cases/:transactionId/release`    | Staff  | Release a claimed case                   |
| `POST` | `/api/v1/review-cases/:transactionId/resolve`    | Staff  | Resolve with a decision                  |

### Appeals

| Method | Path                                             | Auth   | Description                              |
| ------ | ------------------------------------------------ | ------ | ---------------------------------------- |
| `GET`  | `/api/v1/reviews/appeals/pending`                | Staff  | List pending appeal cases                |
| `POST` | `/api/v1/reviews/appeals/:appealId/resolve`      | Staff  | Resolve an appeal                        |

### Legacy (backward compatible)

| Method | Path                                             | Description                              |
| ------ | ------------------------------------------------ | ---------------------------------------- |
| `GET`  | `/api/v1/reviews/pending`                        | Alias for pending review cases           |
| `POST` | `/api/v1/reviews/:transactionId/decision`        | Alias for resolving a review case        |

---

## Review Payload

```json
{
  "decision": "APPROVED",
  "reviewedBy": "analyst-01",
  "notes": "False positive, approve"
}
```

| Field      | Allowed values for reviews       | Allowed values for appeals  |
| ---------- | -------------------------------- | --------------------------- |
| `decision` | `APPROVED`, `DECLINED`           | `UPHOLD`, `REVERSE`         |

---

## Concurrency Model

- Cases move through `PENDING` → `IN_REVIEW` → `REVIEWED`
- Only the active `claimed_by` reviewer can resolve or release a case
- Claim conflicts return HTTP `409`
- `review_case_events` stores claim, release, and resolve history for auditability

---

## Kafka

| Direction | Topic                   | Notes                                   |
| --------- | ----------------------- | --------------------------------------- |
| Consumes  | `transaction.flagged`   | Creates review items                    |
| Produces  | `transaction.reviewed`  | Published after analyst resolves a case |

---

## Environment Variables

| Variable                   | Description                                        |
| -------------------------- | -------------------------------------------------- |
| `KAFKA_INPUT_TOPIC_FLAGGED`| Topic to consume flagged transactions from         |
| `KAFKA_OUTPUT_TOPIC_REVIEWED` | Topic to publish review outcomes to            |
| `APPEAL_SERVICE_URL`       | Base URL of the Appeal Service                     |
| `APPEAL_SERVICE_TIMEOUT_MS`| HTTP timeout for appeal resolution calls           |
| `DB_HOST`                  | PostgreSQL host                                    |
| `DB_PORT`                  | PostgreSQL port                                    |
| `DB_NAME`                  | PostgreSQL database name                           |
| `DB_USER`                  | PostgreSQL username                                |
| `DB_PASSWORD`              | PostgreSQL password                                |
