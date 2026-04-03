# Customer Service

Handles customer registration, OTP verification, OAuth login, and profile management.

**Port:** 8005 | **Type:** Atomic microservice

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/register` | None | Register or reactivate account, then send OTP (no JWT until verified). |
| `POST` | `/login` | None | Validate password and send OTP to registered email. |
| `POST` | `/verify-otp` | None | Verify OTP and mint customer JWT. |
| `POST` | `/resend-otp` | None | Resend OTP to email. |
| `GET` | `/oauth/start?provider=google&next=/banking` | None | Start Google OAuth login. |
| `GET` | `/oauth/callback` | None | OAuth callback, then redirect to UI with JWT in URL fragment. |
| `GET` | `/me` | JWT | Get own profile. |
| `PUT` | `/me` | JWT | Update full_name and phone. |
| `POST` | `/me/request-otp` | JWT | Request OTP for sensitive operations. |
| `PUT` | `/me/password` | JWT + OTP | Change password. |
| `DELETE` | `/me` | JWT + password + OTP | Soft-delete account. |
| `GET` | `/lookup?query=` | JWT | Lookup active customer by email or phone. |
| `GET` | `/internal/contact/{customer_id}` | None | Internal contact lookup by customer ID. |

---

## Data Model

**customers**
| Field | Notes |
|---|---|
| `customer_id` | UUID PK |
| `email` | Unique |
| `password_hash` | bcrypt |
| `full_name` | Required |
| `phone` | Nullable; E.164 when present |
| `is_active` | `false` means soft-deleted |

**otp_codes**
| Field | Notes |
|---|---|
| `customer_id` | FK to customers |
| `code` | 6-digit numeric |
| `expires_at` | 10 minutes from creation |
| `used` | Invalid after first successful verification |

---

## Auth Flow

```text
Password flow:
POST /register or POST /login -> OTP email -> POST /verify-otp -> JWT

OAuth flow:
GET /oauth/start -> provider callback -> redirect to UI with JWT fragment
```

Sensitive actions (password change, delete account) require a fresh OTP via `POST /me/request-otp`.

---

## Environment Variables

| Variable | Description |
|---|---|
| `JWT_SECRET` | HS256 signing secret |
| `JWT_EXPIRE_MINUTES` | Token lifetime (default 60) |
| `SMTP_HOST/PORT/USER/PASSWORD/FROM` | SMTP settings for OTP email |
| `PUBLIC_BASE_URL` | UI base URL used by OAuth callback redirects |
| `OAUTH_GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `OAUTH_GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `OAUTH_GOOGLE_REDIRECT_URI` | Redirect URI registered in Google console |
