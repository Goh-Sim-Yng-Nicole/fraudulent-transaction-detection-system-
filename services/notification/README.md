# Notification Service

Sends email and SMS notifications to customers when key events occur in their transaction or appeal lifecycle.

**Type:** Atomic microservice (Kafka worker only) | **Port:** None

---

## Kafka Events Consumed

| Topic | Handler | Notification sent |
|---|---|---|
| `transaction.flagged` | `_on_flagged` | Tells sender their transaction is under review |
| `transaction.finalised` | `_on_finalised` | Tells sender of APPROVED/REJECTED outcome; also notifies P2P recipient if APPROVED |
| `transaction.reviewed` | `_on_reviewed` | Tells sender of manual review outcome (APPROVED/REJECTED) |
| `appeal.resolved` | `_on_appeal_resolved` | Tells customer of appeal outcome (APPROVED/REJECTED) |

---

## Notification Channels

- **Email** — via Gmail SMTP (aiosmtplib), HTML-formatted
- **SMS** — via Twilio REST API (httpx); falls back to console log if credentials not set

---

## Dependencies

For each event, the service fetches:
1. Transaction details from the transaction service (`TRANSACTION_BASE_URL`)
2. Customer contact (email + phone) from the customer service (`CUSTOMER_BASE_URL`)

---

## Environment Variables

| Variable | Description |
|---|---|
| `TRANSACTION_BASE_URL` | e.g. `http://transaction:8000` |
| `CUSTOMER_BASE_URL` | e.g. `http://customer:8005` |
| `SMTP_HOST/PORT/USER/PASSWORD/FROM` | Gmail SMTP |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER` | Twilio SMS |
