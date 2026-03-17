# Customer Service

**Type:** Atomic Microservice
**Port:** 8005
**Tech:** Python, FastAPI, SQLAlchemy (asyncpg), PostgreSQL

---

## Responsibility

Manages customer identity — registration, authentication, and profile management. Issues JWT tokens that are required by all other authenticated API calls routed through the Gateway.

---

## Key Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/register` | No | Register a new customer account |
| `POST` | `/login` | No | Step 1 of login — validates password, sends OTP email |
| `POST` | `/verify-otp` | No | Step 2 of login — validates OTP, returns JWT |
| `POST` | `/resend-otp` | No | Re-sends OTP to the customer's email |
| `GET` | `/me` | JWT | Returns the authenticated customer's profile |
| `PUT` | `/me` | JWT | Update full name or phone number |
| `PUT` | `/me/password` | JWT | Change password (requires OTP confirmation) |
| `POST` | `/me/request-otp` | JWT | Request OTP for a sensitive operation |
| `DELETE` | `/me` | JWT | Deactivate (soft-delete) the account |
| `GET` | `/lookup?query=` | JWT | Look up another customer by email or phone number |
| `GET` | `/internal/contact/{customer_id}` | None | Internal endpoint — returns contact details for inter-service notifications |

---

## Authentication Flow

1. `POST /login` — verifies password, generates a 6-digit OTP, sends it to the customer's email, returns `202`.
2. `POST /verify-otp` — validates the OTP (10-minute expiry), returns a signed JWT (`Bearer` token).
3. All subsequent requests include `Authorization: Bearer <token>` — the JWT contains `sub` (customer_id) and `iss` (for Kong JWT plugin compatibility).

---

## Recipient Lookup

`GET /lookup?query=` accepts either an **email address** (contains `@`) or a **phone number** (with country code, e.g. `+6591234567`). Used by the frontend before submitting a P2P transfer to confirm the recipient exists.

---

## Data Model

| Field | Type | Notes |
|---|---|---|
| `customer_id` | UUID PK | Auto-generated |
| `full_name` | String | |
| `email` | String | Unique, immutable after registration |
| `phone` | String | Required; must include country code (e.g. `+65...`) |
| `hashed_password` | String | bcrypt |
| `otp_code` | String (nullable) | 6-digit code, cleared after use |
| `otp_expires_at` | Timestamp (nullable) | 10-minute window |
| `is_active` | Boolean | False = soft-deleted |

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (injected by Docker Compose) |
| `JWT_SECRET` | HS256 signing secret |
| `JWT_EXPIRE_MINUTES` | Token lifetime (default: 60) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Email delivery for OTPs |
