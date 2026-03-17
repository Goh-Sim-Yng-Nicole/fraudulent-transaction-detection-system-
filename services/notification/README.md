# Notification Service

**Type:** Atomic Microservice
**Port:** None (Kafka worker only)
**Tech:** Python, aiokafka, aiosmtplib, Twilio REST API (via httpx)

---

## Responsibility

Listens to key Kafka events and sends **email and SMS notifications** to affected customers. It is the only service that directly contacts customers via external channels (SMTP and Twilio).

For each event it:
1. Fetches the full transaction record from the Transaction service
2. Fetches the customer's contact details (email, phone) from the Customer service
3. Sends a styled HTML email via SMTP and an SMS via Twilio

If SMTP or Twilio credentials are not configured, notifications are logged to stdout instead (dev/test mode).

---

## Kafka Events Handled

| Topic | Event | Notification sent |
|---|---|---|
| `transaction.flagged` | `transaction.flagged.v1` | Customer: "Your transaction is under review" |
| `transaction.finalised` | `transaction.finalised.v1` (APPROVED) | Sender: "Transaction approved" + P2P recipient: "You received a transfer" |
| `transaction.finalised` | `transaction.finalised.v1` (REJECTED) | Sender: "Transaction rejected" with reason |
| `transaction.reviewed` | `transaction.reviewed.v1` | Customer: "Manual review outcome" |
| `appeal.resolved` | `appeal.resolved.v1` | Customer: "Appeal resolved" with outcome |

---

## Dependencies (Runtime HTTP)

| Service | Endpoint | Purpose |
|---|---|---|
| Transaction | `GET /transactions/{id}` | Fetch amount, currency, customer_id, recipient_customer_id |
| Customer | `GET /internal/contact/{id}` | Fetch email, phone, full_name (no auth required) |

---

## Environment Variables

| Variable | Description |
|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
| `TRANSACTION_BASE_URL` | Transaction service URL (default: `http://transaction:8000`) |
| `CUSTOMER_BASE_URL` | Customer service URL (default: `http://customer:8005`) |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server for email delivery |
| `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | SMTP credentials |
| `TWILIO_ACCOUNT_SID` | Twilio account SID for SMS |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | Twilio sender number (E.164 format, e.g. `+12345678901`) |
