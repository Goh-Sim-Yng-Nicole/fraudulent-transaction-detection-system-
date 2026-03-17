# Transaction Service

**Type:** Atomic Microservice
**Port:** 8000
**Tech:** Python, FastAPI, SQLAlchemy (asyncpg), PostgreSQL, Kafka consumer

---

## Responsibility

Owns the full lifecycle of every transaction — creation, status updates, and querying. It is the single source of truth for transaction state.

On creation it publishes `transaction.created` to kick off the fraud detection pipeline. It then consumes downstream events to update each transaction's status as it progresses through scoring, flagging, finalisation, manual review, and appeal resolution.

---

## Key Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/transactions` | Submit a new transaction |
| `GET` | `/transactions?customer_id=&direction=` | List transactions for a customer (`all` / `outgoing` / `incoming`) |
| `GET` | `/transactions/{id}` | Get a single transaction record |
| `GET` | `/transactions/{id}/decision` | Get the fraud decision for a transaction |

---

## Transaction Creation

Fields sent by the client:

| Field | Required | Notes |
|---|---|---|
| `amount` | Yes | |
| `currency` | Yes | e.g. `SGD`, `USD` |
| `card_type` | Yes | `CREDIT`, `DEBIT`, `PREPAID` |
| `country` | Yes | ISO 2-letter code |
| `merchant_id` | No | Filled with `FTDS_TRANSFER` for P2P transfers |
| `customer_id` | No | ID of the sender |
| `sender_name` | No | Display name of the sender (stored for history) |
| `recipient_customer_id` | No | Set for P2P (customer-to-customer) transfers |
| `recipient_name` | No | Display name of the recipient (stored for history) |
| `hour_utc` | No | Auto-filled server-side from UTC time if omitted |

After persisting, the service publishes a `transaction.created` Kafka event.

---

## Direction Filtering

`GET /transactions` accepts a `direction` query parameter:

- `outgoing` — transactions where `customer_id` matches the viewer
- `incoming` — transactions where `recipient_customer_id` matches the viewer **and** status is `APPROVED`
- `all` (default) — union of both, sorted by `created_at` descending

---

## Kafka Events Consumed

| Topic | Action |
|---|---|
| `transaction.scored` | Store the fraud score |
| `transaction.flagged` | Store score, set status → `FLAGGED` |
| `transaction.finalised` | Store score, set status → `APPROVED` or `REJECTED` |
| `transaction.reviewed` | Set status → `RESOLVED` |
| `appeal.resolved` | Set status → `RESOLVED` |

---

## Transaction Statuses

`PENDING` → `FLAGGED` → `RESOLVED`
`PENDING` → `APPROVED`
`PENDING` → `REJECTED` → `RESOLVED` (via appeal)

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
| `CUSTOMER_BASE_URL` | URL of the Customer Service (for inter-service calls) |
