# Transaction Service

Stores transactions and keeps their status up to date by consuming Kafka decision events.

**Port:** `8000` | **Runtime:** Python / FastAPI | **Type:** Atomic microservice

---

## Endpoints

| Method | Path                                      | Description                               |
| ------ | ----------------------------------------- | ----------------------------------------- |
| `POST` | `/transactions`                           | Create transaction (status = `PENDING`)   |
| `GET`  | `/transactions?customer_id=&direction=`   | List transactions for a customer          |
| `GET`  | `/transactions/{transaction_id}`          | Get a single transaction                  |
| `GET`  | `/transactions/{transaction_id}/decision` | Get fraud decision fields only            |

**Direction values:** `all` / `outgoing` / `incoming`

---

## Data Model

**transactions**

| Field                          | Notes                                        |
| ------------------------------ | -------------------------------------------- |
| `transaction_id`               | UUID PK                                      |
| `customer_id`                  | Sender's UUID                                |
| `recipient_customer_id`        | Nullable — P2P transfers only                |
| `sender_name`                  | Nullable; enriched by gateway                |
| `recipient_name`               | Nullable; enriched by gateway                |
| `merchant_id`                  | Merchant identifier or `FTDS_TRANSFER`       |
| `amount`                       | NUMERIC                                      |
| `currency`                     | e.g. `SGD`                                   |
| `card_type`                    | e.g. `DEBIT`, `CREDIT`                       |
| `country`                      | ISO country code                             |
| `hour_utc`                     | UTC hour at submission                       |
| `status`                       | `PENDING` → `APPROVED` / `REJECTED` / `FLAGGED` |
| `fraud_score`                  | 0–100; set by decision event                 |
| `outcome_reason`               | Decision reason text                         |
| `correlation_id`               | Trace ID from originating request            |
| `outbound_event_published_at`  | Timestamp when Kafka event was published     |
| `outbound_event_publish_attempts` | Retry count for outbound publish          |

---

## Kafka

| Direction | Topic                   | Effect                                              |
| --------- | ----------------------- | --------------------------------------------------- |
| Produces  | `transaction.created`   | Published on every new transaction                  |
| Consumes  | `transaction.flagged`   | Sets status to `FLAGGED`                            |
| Consumes  | `transaction.finalised` | Sets status to `APPROVED` or `REJECTED`; stores score and reason |
| Consumes  | `transaction.reviewed`  | Sets status to `APPROVED` or `REJECTED` after manual review |

---

## Direction Logic

Direction is computed at query time:

- **outgoing** — `customer_id` matches the querying customer
- **incoming** — `recipient_customer_id` matches the querying customer
- **all** — either condition matches

---

## Environment Variables

| Variable              | Description                          |
| --------------------- | ------------------------------------ |
| `DATABASE_URL`        | PostgreSQL connection string         |
| `KAFKA_BOOTSTRAP`     | Kafka broker address                 |
| `SERVICE_NAME`        | Service identifier for Kafka headers |
| `AUTO_CREATE_TABLES`  | `true` to run migrations on startup  |
