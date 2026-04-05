# Notification Service

Consumes fraud decision events and delivers notifications to customers and the fraud team via email or SMS.

**Port:** `8010` | **Runtime:** Node.js / Express | **Type:** Atomic microservice

---

## Kafka

| Direction | Topic                   | Effect                                                  |
| --------- | ----------------------- | ------------------------------------------------------- |
| Consumes  | `transaction.finalised` | Notifies customer of approval or rejection outcome      |
| Consumes  | `transaction.flagged`   | Notifies fraud team of a flagged transaction            |

If event contact details are missing, the service falls back to the fallback recipients configured in `.env`.

---

## Supported Providers

| Channel | Providers           |
| ------- | ------------------- |
| Email   | `mock`, `smtp`      |
| SMS     | `mock`, `twilio`    |

For local and CI runs, `.env.example` keeps notifications on `mock` providers and leaves OTP delivery on Mailpit.

---

## Environment Variables

### Email

| Variable              | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `EMAIL_ENABLED`       | `true` to enable email notifications                 |
| `EMAIL_PROVIDER`      | `smtp` or `mock`                                     |
| `EMAIL_SMTP_HOST`     | SMTP host (e.g. `smtp.gmail.com`)                    |
| `EMAIL_SMTP_PORT`     | SMTP port (e.g. `587`)                               |
| `EMAIL_SMTP_SECURE`   | `true` for TLS, `false` for STARTTLS                 |
| `EMAIL_SMTP_USER`     | SMTP username                                        |
| `EMAIL_SMTP_PASSWORD` | SMTP password or app password                        |
| `EMAIL_FROM_ADDRESS`  | From address for notification emails                 |
| `EMAIL_FROM_NAME`     | From name for notification emails                    |

### SMS

| Variable              | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `SMS_ENABLED`         | `true` to enable SMS notifications                   |
| `SMS_PROVIDER`        | `twilio` or `mock`                                   |
| `TWILIO_ACCOUNT_SID`  | Twilio account SID                                   |
| `TWILIO_AUTH_TOKEN`   | Twilio auth token                                    |
| `TWILIO_PHONE_NUMBER` | Twilio sender phone number (E.164)                   |

### Fallback recipients

| Variable                              | Description                                    |
| ------------------------------------- | ---------------------------------------------- |
| `NOTIFICATION_CUSTOMER_FALLBACK_EMAIL`| Email used when customer email is not in event |
| `NOTIFICATION_CUSTOMER_FALLBACK_PHONE`| Phone used when customer phone is not in event |
| `NOTIFICATION_FRAUD_TEAM_EMAIL`       | Fraud team email for flagged alerts            |
| `NOTIFICATION_FRAUD_TEAM_PHONE`       | Fraud team phone for flagged alerts            |

### Customer OTP (separate — keep on Mailpit)

| Variable                | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `CUSTOMER_SMTP_HOST`    | Keep set to `mailpit` for OTP demo retrieval     |
| `CUSTOMER_SMTP_PORT`    | `1025`                                           |
| `CUSTOMER_SMTP_FROM`    | `banking@ftds.local`                             |
| `CUSTOMER_SMTP_STARTTLS`| `false`                                          |

---

## Example `.env` Configuration

```env
EMAIL_ENABLED=true
EMAIL_PROVIDER=smtp
EMAIL_SMTP_HOST=smtp-relay.brevo.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_USER=your-brevo-login
EMAIL_SMTP_PASSWORD=your-brevo-smtp-key
EMAIL_FROM_ADDRESS=alerts@your-domain.example
EMAIL_FROM_NAME=FTDS Notifications

SMS_ENABLED=true
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx

CUSTOMER_SMTP_HOST=mailpit
CUSTOMER_SMTP_PORT=1025
CUSTOMER_SMTP_USER=
CUSTOMER_SMTP_PASSWORD=
CUSTOMER_SMTP_FROM=banking@ftds.local
CUSTOMER_SMTP_STARTTLS=false
```

---

## Health Check

```powershell
Invoke-RestMethod http://localhost:8010/api/v1/health | ConvertTo-Json -Depth 6
```

Fields to verify:

- `dependencies.email.mode`
- `dependencies.sms.mode`
- `notificationProviders.realProviderEnabled`

---

## Notes

- Gmail requires an app password for SMTP; standard passwords are blocked
- Twilio trial accounts can only send to verified recipient numbers
- OTP delivery remains email-based via Mailpit; configure `CUSTOMER_SMTP_*` separately from `EMAIL_*`
