# Customer Service

Handles customer registration, authentication (JWT + OTP), and profile management.

**Port:** 8005 | **Type:** Atomic microservice

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/register` | None | Register; returns JWT immediately. Re-registers soft-deleted accounts. |
| `POST` | `/login` | None | Sends OTP to registered email |
| `POST` | `/verify-otp` | None | Submit OTP → returns JWT |
| `POST` | `/resend-otp` | None | Resend OTP to email |
| `GET` | `/me` | JWT | Get own profile |
| `PUT` | `/me` | JWT | Update full_name and phone |
| `POST` | `/me/request-otp` | JWT | Request OTP for sensitive operations |
| `PUT` | `/me/password` | JWT + OTP | Change password |
| `DELETE` | `/me` | JWT + password + OTP | Soft-delete account |
| `GET` | `/lookup?query=` | JWT | Lookup active customer by email or phone |
| `GET` | `/internal/contact/{customer_id}` | None | Internal: get name + email by ID |

---

## Data Model

**customers**
| Field | Notes |
|---|---|
| `customer_id` | UUID PK |
| `email` | Unique |
| `password_hash` | bcrypt |
| `full_name` | |
| `phone` | E.164 e.g. +6591234567 |
| `is_active` | False = soft deleted |

**otp_codes**
| Field | Notes |
|---|---|
| `customer_id` | FK to customers |
| `code` | 6-digit numeric |
| `purpose` | `login` / `change_password` / `delete_account` |
| `expires_at` | 10 min from creation |
| `used` | Invalidated after first use |

---

## Auth Flow

```
POST /login → OTP emailed → POST /verify-otp → JWT
```

Sensitive actions (password change, delete) require a fresh OTP via `POST /me/request-otp`.

Soft-deleted accounts can re-register with the same email — the existing row is reactivated with new credentials.

---

## Environment Variables

| Variable | Description |
|---|---|
| `JWT_SECRET` | HS256 signing secret |
| `JWT_EXPIRE_MINUTES` | Token lifetime (default 60) |
| `SMTP_HOST/PORT/USER/PASSWORD/FROM` | Gmail SMTP for OTP emails |
| `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER` | Optional SMS via Twilio |
