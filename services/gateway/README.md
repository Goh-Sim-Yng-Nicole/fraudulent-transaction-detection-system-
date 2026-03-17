# Gateway Service (BFF)

**Type:** Composite Service
**Port:** 8004
**Tech:** Python, FastAPI, httpx

---

## Responsibility

Acts as a **Backend for Frontend (BFF)** — a single entry point that proxies and composes requests from the Customer Banking UI to the appropriate downstream atomic services. Nginx routes all `/api/` traffic here (except auth and customer profile, which go directly to the Customer service).

The gateway also enriches certain responses — for example, it back-fills missing `sender_name` / `recipient_name` on transaction records by looking up the Customer service, ensuring the UI always displays human-readable names.

---

## Route Map

### Auth & Profile (proxied to Customer Service)

| Gateway route | Downstream |
|---|---|
| `POST /auth/register` | `POST customer:8005/register` |
| `POST /auth/login` | `POST customer:8005/login` |
| `POST /auth/verify-otp` | `POST customer:8005/verify-otp` |
| `POST /auth/resend-otp` | `POST customer:8005/resend-otp` |
| `GET /customers/me` | `GET customer:8005/me` |
| `PUT /customers/me` | `PUT customer:8005/me` |
| `PUT /customers/me/password` | `PUT customer:8005/me/password` |
| `POST /customers/me/request-otp` | `POST customer:8005/me/request-otp` |
| `DELETE /customers/me` | `DELETE customer:8005/me` |
| `GET /customers/lookup?query=` | `GET customer:8005/lookup?query=` |

### Customer Banking (proxied to Transaction & Appeal Services)

| Gateway route | Downstream | Notes |
|---|---|---|
| `GET /customer/transactions` | `GET transaction:8000/transactions` | Enriches missing names from Customer service |
| `POST /customer/transactions` | `POST transaction:8000/transactions` | |
| `GET /customer/transactions/{id}` | `GET transaction:8000/transactions/{id}` | |
| `GET /customer/transactions/{id}/decision` | `GET transaction:8000/transactions/{id}/decision` | |
| `POST /customer/appeals` | `POST appeal:8003/appeals` | |
| `GET /customer/appeals/{id}` | `GET appeal:8003/appeals/{id}` | |

### Fraud Review Team (proxied to Process Flagged & Appeals)

| Gateway route | Downstream |
|---|---|
| `GET /fraud/flagged` | `GET fraud-review:8002/flagged` |
| `POST /fraud/flagged/{id}/resolve` | `POST fraud-review:8002/flagged/{id}/resolve` |
| `GET /fraud/appeals` | `GET fraud-review:8002/appeals` |
| `POST /fraud/appeals/{id}/resolve` | `POST fraud-review:8002/appeals/{id}/resolve` |

---

## Name Enrichment

When serving `GET /customer/transactions`, the gateway detects missing `sender_name` / `recipient_name` fields (e.g. for transactions created before the field was added) and fetches the customer's full name from `GET customer:8005/internal/contact/{id}`, returning enriched records to the UI.

---

## Error Handling

All downstream errors are caught and re-raised as HTTP exceptions with the original status code and detail. Connection errors return `502 Bad Gateway`.

---

## Environment Variables

| Variable | Description |
|---|---|
| `TRANSACTION_BASE_URL` | Transaction service URL (default: `http://transaction:8000`) |
| `FRAUD_REVIEW_BASE_URL` | Process Flagged & Appeals URL (default: `http://fraud-review:8002`) |
| `APPEAL_BASE_URL` | Appeal service URL (default: `http://appeal:8003`) |
| `CUSTOMER_BASE_URL` | Customer service URL (default: `http://customer:8005`) |
