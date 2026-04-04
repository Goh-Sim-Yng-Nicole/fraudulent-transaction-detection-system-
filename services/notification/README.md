# Notification Service

This service consumes fraud decision events and sends notifications by email or SMS.

## Supported Providers

- Email: `mock`, `smtp`
- SMS: `mock`, `twilio`

For local/CI demo stacks, `.env.example` keeps notification email on Mailpit and SMS disabled.
For localhost and deployment environments, use the project root `.env` to point notification delivery at external providers while leaving `CUSTOMER_SMTP_*` on Mailpit for OTP demos. Mailpit only handles email in this repo; OTP delivery remains email-based for the demo flow.

## Important Environment Variables

### SMTP email

```env
EMAIL_ENABLED=true
EMAIL_PROVIDER=smtp
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_USER=your-account@example.com
EMAIL_SMTP_PASSWORD=your-app-password
EMAIL_FROM_ADDRESS=your-account@example.com
EMAIL_FROM_NAME=Fraud Detection System
```

### Twilio SMS

```env
SMS_ENABLED=true
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
```

Practical low-cost demo setup:

- Email notifications: point `EMAIL_*` at an SMTP provider such as Brevo or Gmail
- SMS notifications: point `SMS_*` and `TWILIO_*` at Twilio

Keep customer OTP demo delivery separate:

```env
CUSTOMER_SMTP_HOST=mailpit
CUSTOMER_SMTP_PORT=1025
CUSTOMER_SMTP_USER=
CUSTOMER_SMTP_PASSWORD=
CUSTOMER_SMTP_FROM=banking@ftds.local
CUSTOMER_SMTP_STARTTLS=false
```

Recommended localhost/deployment `.env` shape:

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

### Fallback recipients

```env
NOTIFICATION_CUSTOMER_FALLBACK_EMAIL=real-customer@example.com
NOTIFICATION_CUSTOMER_FALLBACK_PHONE=+1xxxxxxxxxx
NOTIFICATION_FRAUD_TEAM_EMAIL=fraud-team@example.com
NOTIFICATION_FRAUD_TEAM_PHONE=+1xxxxxxxxxx
```

## Start

From the project root:

```bash
docker compose up --build -d
```

If you only changed notification credentials:

```bash
docker compose up --build -d notification-service
```

## Verify

Health endpoint:

```powershell
Invoke-RestMethod http://localhost:3006/api/v1/health | ConvertTo-Json -Depth 6
```

Check these fields:

- `dependencies.email.mode`
- `dependencies.sms.mode`
- `notificationProviders.realProviderEnabled`

Proof script:

```bash
cd testing
npm run proof:notification
```

To require a real external provider:

```powershell
cd testing
$env:REQUIRE_REAL_NOTIFICATION_PROVIDER='true'
npm run proof:notification
```

## API Docs

- Swagger UI: `http://localhost:3006/api-docs`
- Health endpoint: `http://localhost:3006/api/v1/health`

## Notes

- The service consumes `transaction.finalised` and `transaction.flagged`.
- If event contact details are missing, the service falls back to the values in `.env`.
- Gmail usually requires an app password for SMTP.
- Twilio trial accounts can only send to verified numbers.
