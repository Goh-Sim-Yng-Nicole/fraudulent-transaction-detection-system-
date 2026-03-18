# Gateway Service

Backend-for-Frontend (BFF) that aggregates and enriches data from downstream services for the customer banking UI.

**Port:** 8004 | **Type:** Composite service

---

## Customer Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/customer/transactions?customer_id=&direction=` | List transactions with name enrichment |
| `GET` | `/customer/transactions/{id}/detail` | Full transaction detail |
| `GET` | `/customer/transactions/{id}/decision` | Fraud decision for a transaction |
| `GET` | `/customer/appeals?customer_id=` | List customer's own appeals |
| `POST` | `/customer/appeals` | Submit appeal (passes `customer_id` to appeal service) |
| `GET` | `/customer/appeals/{appeal_id}` | Get a single appeal |

## Customer Profile Routes (proxied to customer service)

| Method | Path | Description |
|---|---|---|
| `GET` | `/customers/me` | Get own profile |
| `PUT` | `/customers/me` | Update profile |
| `DELETE` | `/customers/me` | Delete account |
| `GET` | `/customers/lookup?query=` | Lookup by email or phone |

## Auth Routes (proxied to customer service)

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Register |
| `POST` | `/auth/login` | Login (sends OTP) |
| `POST` | `/auth/verify-otp` | Verify OTP → JWT |
| `POST` | `/auth/resend-otp` | Resend OTP |

## Fraud Review Routes (proxied to process_flagged_appeals)

| Method | Path | Description |
|---|---|---|
| `GET` | `/fraud/flagged` | List flagged cases |
| `POST` | `/fraud/flagged/{id}/resolve` | Resolve flagged transaction |
| `GET` | `/fraud/appeals` | List appeals queue |
| `POST` | `/fraud/appeals/{id}/resolve` | Resolve appeal |

---

## Name Enrichment

For `GET /customer/transactions`, the gateway back-fills missing `sender_name` / `recipient_name` at runtime by calling `GET /internal/contact/{customer_id}` on the customer service. This handles transactions created before the name columns were added.

---

## Downstream Services

| Service | Env var | Default |
|---|---|---|
| transaction | `TRANSACTION_BASE_URL` | `http://transaction:8000` |
| customer | `CUSTOMER_BASE_URL` | `http://customer:8005` |
| fraud review | `FRAUD_REVIEW_BASE_URL` | `http://fraud-review:8002` |
| appeal | `APPEAL_BASE_URL` | `http://appeal:8003` |
