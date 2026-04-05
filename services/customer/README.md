# Customer Service

Handles customer registration, authentication (JWT + OTP), and profile management.

**Port:** `8005` | **Runtime:** Python / FastAPI | **Type:** Atomic microservice

---

## Endpoints

| Method   | Path                             | Auth                  | Description                                                          |
| -------- | -------------------------------- | --------------------- | -------------------------------------------------------------------- |
| `POST`   | `/register`                      | None                  | Register a new account; returns OTP challenge. Reactivates soft-deleted accounts. |
| `POST`   | `/login`                         | None                  | Validate credentials; sends OTP to registered email                  |
| `POST`   | `/verify-otp`                    | None                  | Submit OTP → returns JWT                                             |
| `POST`   | `/resend-otp`                    | None                  | Resend OTP to email                                                  |
| `GET`    | `/me`                            | JWT                   | Get own profile                                                      |
| `PUT`    | `/me`                            | JWT                   | Update `full_name` and `phone`                                       |
| `POST`   | `/me/request-otp`                | JWT                   | Request OTP for sensitive operations                                 |
| `POST`   | `/me/password/set`               | JWT + OTP             | Set initial password (passwordless accounts)                         |
| `PUT`    | `/me/password`                   | JWT + OTP             | Change password                                                      |
| `DELETE` | `/me`                            | JWT + password + OTP  | Soft-delete account                                                  |
| `GET`    | `/lookup?query=`                 | JWT                   | Look up active customer by email or phone                            |
| `GET`    | `/internal/contact/{customer_id}`| None                  | Internal: get name and email by ID                                   |

---

## Data Model

**customers**

| Field           | Notes                        |
| --------------- | ---------------------------- |
| `customer_id`   | UUID PK                      |
| `email`         | Unique                       |
| `password_hash` | bcrypt; nullable for OAuth-backed accounts |
| `full_name`     |                              |
| `phone`         | E.164 e.g. `+6591234567`     |
| `is_active`     | `false` = soft deleted       |
| `has_password`  | Derived; `false` if no local password hash |

**otp_codes**

| Field       | Notes                                              |
| ----------- | -------------------------------------------------- |
| `customer_id` | FK to customers                                  |
| `code`      | 6-digit numeric                                    |
| `purpose`   | `login` / `change_password` / `delete_account`     |
| `expires_at`| 10 minutes from creation                           |
| `used`      | Invalidated after first use                        |

---

## Auth Flow

```text
POST /register → OTP emailed → POST /verify-otp → JWT

POST /login → OTP emailed → POST /verify-otp → JWT
```

Sensitive actions (password change, account deletion) require a fresh OTP via `POST /me/request-otp`.

Soft-deleted accounts can re-register with the same email — the existing row is reactivated with new credentials.

---

## Passwordless Accounts

The service supports customer rows with no local password hash (e.g. OAuth-backed accounts). Those accounts can:

- call `GET /me` and `POST /me/request-otp`
- call `POST /me/password/set` to set an initial local password

Until a local password is set, they cannot update their profile, change their password, delete the account, create transactions, or submit appeals.

---

## Kafka

| Direction | Topic                    | Effect                                         |
| --------- | ------------------------ | ---------------------------------------------- |
| Consumes  | `transaction.finalised`  | Sends transaction outcome email to customer    |
| Consumes  | `appeal.resolved`        | Sends appeal outcome email to customer         |

---

## Environment Variables

| Variable                    | Description                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| `JWT_SECRET`                | HS256 signing secret                                             |
| `JWT_EXPIRE_MINUTES`        | Token lifetime (default `60`)                                    |
| `CUSTOMER_SMTP_HOST`        | SMTP host for OTP emails; keep pointed at Mailpit for demos      |
| `CUSTOMER_SMTP_PORT`        | SMTP port (default `1025` for Mailpit)                           |
| `CUSTOMER_SMTP_USER`        | SMTP username (blank for Mailpit)                                |
| `CUSTOMER_SMTP_PASSWORD`    | SMTP password (blank for Mailpit)                                |
| `CUSTOMER_SMTP_FROM`        | From address for OTP emails                                      |
| `CUSTOMER_SMTP_STARTTLS`    | `true` / `false` (default `false` for Mailpit)                   |
| `DATABASE_URL`              | PostgreSQL connection string                                     |
