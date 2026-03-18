# Transaction Service

Stores transactions and keeps their status up to date by consuming Kafka events.

**Port:** 8000 | **Type:** Atomic microservice

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/transactions` | Create transaction (status = PENDING) |
| `GET` | `/transactions?customer_id=&direction=` | List transactions for a customer |
| `GET` | `/transactions/{transaction_id}` | Get a single transaction |
| `GET` | `/transactions/{transaction_id}/decision` | Get fraud decision fields |

**Direction values:** `all` / `outgoing` / `incoming`

---

## Data Model

**transactions**
| Field | Notes |
|---|---|
| `transaction_id` | UUID PK |
| `customer_id` | Sender's UUID |
| `recipient_customer_id` | Nullable (P2P transfers only) |
| `sender_name` | Nullable, enriched by gateway |
| `recipient_name` | Nullable, enriched by gateway |
| `amount` | NUMERIC |
| `currency` | e.g. SGD |
| `merchant_name` | Nullable |
| `merchant_uen` | Nullable |
| `card_type` | e.g. DEBIT, CREDIT |
| `status` | PENDING → APPROVED / REJECTED / FLAGGED |
| `rules_score` | 0–100 |
| `reason` | Decision reason text |

---

## Kafka Events Consumed

| Topic | Effect |
|---|---|
| `transaction.flagged` | status = FLAGGED |
| `transaction.finalised` | status = APPROVED or REJECTED, stores score + reason |
| `transaction.reviewed` | status = APPROVED or REJECTED (manual outcome) |

---

## Direction Logic

Computed at query time:
- **OUTGOING** — `customer_id` matches the querying customer
- **INCOMING** — `recipient_customer_id` matches the querying customer
