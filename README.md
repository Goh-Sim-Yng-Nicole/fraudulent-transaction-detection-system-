<div align="center">

<img src="ui/assets/images/app-logo.png" alt="FTDS Logo" width="160" />

# 🏦 Fraudulent Transaction Detection System

_Does Your Bank Actually Protect You From Fraud?_

A production-grade microservices platform simulating end-to-end fraud operations — combining real-time scoring, manual analyst review, customer appeals, and full observability in a single Docker-based stack.

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-latest-009688?logo=fastapi&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)
![Kafka](https://img.shields.io/badge/Kafka-Redpanda-E50914?logo=apachekafka&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-Educational-brightgreen)

</div>

---

## 📖 About

FTDS is a microservices-based banking platform for end-to-end fraud operations. It brings together customer onboarding and authentication, transaction decisioning, manual fraud review, customer appeals, analytics, auditability, notifications, and observability in a single Docker-based stack.

The platform is designed to support three user-facing journeys:

- 🚨 **Scenario 1** — a fraudulent transaction is detected and rejected
- 🔍 **Scenario 2** — a risky transaction is flagged and manually reviewed
- ⚖️ **Scenario 3** — a declined transaction is appealed and later reversed

**What's inside:**

- Customer registration, login, OTP verification, profile management, and account lifecycle actions
- Passwordless customer support for OAuth-backed accounts that must set a local password before sensitive actions
- Transaction creation, listing, decision lookup, and Kafka-driven status propagation
- Fraud scoring and fraud orchestration across rules, ML scoring, and decision services
- Analyst review queues with claim, release, and ownership tracking
- Customer appeal submission with one-time appeal enforcement
- Manager analytics dashboards and realtime fraud metrics
- Audit trail storage and audit-chain verification
- Notification delivery through external SMTP email and Twilio SMS, while OTP remains demo-safe through Mailpit
- Observability through Grafana, Jaeger, Prometheus, and cAdvisor

---

## 🌿 Branch Strategy

| Branch       | Purpose                                                   |
| ------------ | --------------------------------------------------------- |
| `main`       | Localhost-first development branch for local Docker usage |
| `deployment` | Deployment branch for the VM / HTTPS environment          |

- `main` is the baseline local stack for development and localhost demos
- `deployment` carries the cloud-facing deployment behaviour, including the HTTPS host configuration and deployment-specific customer auth flow support

---

## 🏗️ Architecture Overview

```text
Customer UI / Staff UI / Manager UI
  -> Nginx
  -> Kong
  -> Gateway

Gateway routes to:
  -> Customer
  -> Transaction
  -> Fraud Review
  -> Appeal
  -> Analytics
  -> Audit

Event pipeline:
  Transaction
    -> transaction.created
    -> detect_fraud
    -> fraud_score
    -> transaction.scored
    -> decision
    -> transaction.flagged / transaction.finalised

Manual review pipeline:
  fraud-review
    -> transaction.reviewed
    -> appeal.created
    -> appeal.resolved

Observability:
  OpenTelemetry Collector
    -> Jaeger
    -> Prometheus
    -> Grafana
    -> cAdvisor
```

---

## ⚙️ Services

| Service        | Runtime          | Port   | Responsibility                                                   |
| -------------- | ---------------- | ------ | ---------------------------------------------------------------- |
| `customer`     | Python / FastAPI | `8005` | Registration, OTP auth, customer profile, and password lifecycle |
| `transaction`  | Python / FastAPI | `8000` | Transaction submission, listing, and decision state              |
| `fraud-score`  | Node / Express   | `8001` | Fraud score calculation                                          |
| `detect-fraud` | Python           | `8008` | Fraud rules orchestration and scoring pipeline                   |
| `decision`     | Node / Express   | `3005` | Decision persistence and Kafka decision events                   |
| `fraud-review` | Node / Express   | `8002` | Analyst review queues for flagged transactions and appeals       |
| `appeal`       | Node / Express   | `8003` | Appeal creation and appeal state management                      |
| `analytics`    | Node / Express   | `8006` | Fraud and appeal analytics for managers                          |
| `audit`        | Node / Express   | `8007` | Audit event storage and integrity verification                   |
| `notification` | Node / Express   | `8010` | Customer and fraud-team notifications                            |
| `gateway`      | Node / Express   | `8004` | Aggregated public API, legacy proxying, and staff authentication |

---

## 👥 User Roles

| Role            | Default Credentials          | Responsibility                                     |
| --------------- | ---------------------------- | -------------------------------------------------- |
| `fraud_analyst` | `analyst` / `analyst123`     | Claim and resolve flagged transactions and appeals |
| `fraud_manager` | `manager` / `manager123`     | Review analytics and fraud outcomes                |
| `ops_readonly`  | `opsviewer` / `opsviewer123` | View observability and operational surfaces        |
| `ops_admin`     | `opsadmin` / `opsadmin123`   | Ops access plus Mailpit administration             |

> These credentials are for local or demo use only.

---

## 🔐 Customer Authentication Model

FTDS supports two customer account states:

| Account State                        | Behaviour                                                        |
| ------------------------------------ | ---------------------------------------------------------------- |
| Local-password customer              | Can sign in with email/password plus OTP                         |
| Passwordless / OAuth-backed customer | Must first set a local password before protected account changes |

Protected customer actions require a local password:

- profile updates
- password changes
- account deletion
- transaction submission
- appeal submission

In the banking UI:

- the customer can request a setup OTP and set an initial local password
- appeal submission is hidden entirely when no transactions exist
- repeat appeals for the same transaction are blocked

---

## 📬 Notification Model

| Channel            | Intended Behaviour                                |
| ------------------ | ------------------------------------------------- |
| Customer OTP       | Email via Mailpit for demo and verification flows |
| Notification email | External SMTP provider                            |
| Notification SMS   | External Twilio provider                          |

OTP messages remain visible in Mailpit for demos and automated tests. Transaction and decision notifications can be routed to a real inbox and real phone number.

---

## 🚀 Local Development

### Prerequisites

- **Docker Desktop** with Docker Compose (Docker Desktop 4.x or later)
- **Node.js 20+** (for running tests and quality checks)
- **Python 3.11+** (only needed if running Python services outside Docker)
- Ports **80, 443, 3000, 8004, 8025, 8088, 8443, 9090, 9091, 16686** must be free on your machine

> If you have another Docker project holding ports 8000–8002 or 80, stop it before starting the stack — otherwise the gateway and nginx containers will fail to bind.

### Environment Setup

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

For local OTP demos, keep:

```env
CUSTOMER_SMTP_HOST=mailpit
CUSTOMER_SMTP_PORT=1025
CUSTOMER_SMTP_USER=
CUSTOMER_SMTP_PASSWORD=
CUSTOMER_SMTP_FROM=banking@ftds.local
CUSTOMER_SMTP_STARTTLS=false
```

For external notification delivery, configure:

```env
EMAIL_ENABLED=true
EMAIL_PROVIDER=smtp
EMAIL_SMTP_HOST=your-smtp-host
EMAIL_SMTP_PORT=587
EMAIL_SMTP_SECURE=false
EMAIL_SMTP_USER=your-user
EMAIL_SMTP_PASSWORD=your-password
EMAIL_FROM_ADDRESS=alerts@your-domain
EMAIL_FROM_NAME=FTDS Notifications

SMS_ENABLED=true
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
```

### Start The Stack

**First run** (builds all images):

```powershell
docker compose up -d --build --remove-orphans
```

**Subsequent runs** (no code changes):

```powershell
docker compose up -d
```

Startup takes roughly 2–3 minutes. Services start in dependency order: databases and Kafka first, then migration jobs, then microservices, then gateway, nginx, and Kong last.

To follow startup progress:

```powershell
docker compose ps
docker compose logs -f gateway
```

If any service is stuck, check its logs:

```powershell
docker compose logs --tail=50 <service-name>
```

### Stop The Stack

Stop containers but keep all data:

```powershell
docker compose down
```

Full teardown including all volumes (clean slate for next run):

```powershell
docker compose down -v --remove-orphans
```

### Main Local URLs

| Surface                 | URL                                       |
| ----------------------- | ----------------------------------------- |
| Banking portal          | `http://localhost/banking.html`           |
| Banking portal (direct) | `http://localhost:8088/banking.html`      |
| Staff login             | `http://localhost:8088/staff-login.html`  |
| Fraud review UI         | `http://localhost:8088/fraud-review.html` |
| Manager dashboard       | `http://localhost:8088/manager.html`      |
| Mailpit (OTP emails)    | `http://localhost:8025`                   |
| Grafana                 | `http://localhost:3000`                   |
| Jaeger                  | `http://localhost:16686`                  |
| Prometheus              | `http://localhost:9090`                   |
| cAdvisor                | `http://localhost:9091`                   |
| API Gateway (direct)    | `http://localhost:8004`                   |
| HTTPS ingress rehearsal | `https://localhost/staff-login.html`      |

### First-Run Walkthrough

1. Open **http://localhost/banking.html**
2. Register a new customer account with your email
3. Open **http://localhost:8025** (Mailpit) to retrieve the OTP email
4. Enter the OTP in the banking portal to complete registration and log in
5. Submit a transaction — high-risk transactions are flagged or rejected automatically
6. Log in to the fraud review UI as an analyst to review flagged cases

---

## 🎬 Demo Scenarios

### Scenario 1: Fraudulent Transaction Rejected

- customer submits a clearly risky transaction
- fraud detection rejects the transaction
- notification, audit, and analytics are updated

### Scenario 2: Risky Transaction Flagged Then Reviewed

- customer submits a transaction that should be flagged
- analyst claims and resolves the review case
- customer sees the updated transaction outcome

### Scenario 3: Declined Transaction Then Appeal Reversal

- analyst declines a risky transaction
- customer submits an appeal
- analyst resolves the appeal
- analytics, audit, and transaction state are updated accordingly

---

## 🚢 Deployment Notes

Use the `deployment` branch when targeting the VM / HTTPS environment.

Key deployment-facing environment variables:

- `PUBLIC_BASE_URL`
- `CUSTOMER_PORTAL_URL`
- `OAUTH_GOOGLE_CLIENT_ID`
- `OAUTH_GOOGLE_CLIENT_SECRET`
- `OAUTH_GOOGLE_REDIRECT_URI`
- external `EMAIL_*` and `TWILIO_*` values for business notifications

The deployment environment uses:

- HTTPS customer access
- Google OAuth support on the deployment branch
- passwordless-to-local-password upgrade flow for OAuth-backed customers
- Mailpit only for OTP demo visibility

---

## 📮 Postman Assets

Importable Postman assets are provided in [`testing/postman`](testing/postman):

- [`ftds-user-scenarios.postman_collection.json`](testing/postman/ftds-user-scenarios.postman_collection.json)
- [`ftds-local.postman_environment.json`](testing/postman/ftds-local.postman_environment.json)
- [`README.md`](testing/postman/README.md)

The collection includes:

1. Bootstrap
2. Scenario 1: Fraudulent Transaction Rejected
3. Scenario 2: Risky Transaction Flagged Then Reviewed
4. Scenario 3: Declined Transaction Then Appeal Reversal

---

## 🧪 Testing

### Key Commands

```powershell
npm.cmd run quality
npm.cmd run test:unit
npm.cmd run test:smoke
npm.cmd run test:contracts
npm.cmd run test:e2e
npm.cmd run test:journey
npm.cmd run test:verify
```

`test:verify` runs the complete local verification chain:

```text
unit -> smoke -> contracts -> e2e -> journey
```

### Coverage Summary

- unit logic for analytics, appeals, notifications, and Python fraud logic
- smoke health across the platform surfaces
- service contracts, observability endpoints, Kafka topic readiness, and consumer lag
- passwordless customer setup flow
- transaction review and appeal resolution flows
- customer lifecycle actions such as password rotation and account deletion
- full scenario-style end-to-end journeys

---

## 🔄 GitHub Actions

The main CI workflow lives at [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

It mirrors the local verification flow and currently performs:

1. checkout and runtime setup
2. `npm run quality`
3. `npm run test:unit`
4. `docker compose config -q`
5. full Docker build
6. stack startup
7. `npm run test:smoke`
8. `npm run test:contracts`
9. `npm run test:e2e`
10. `npm run test:journey`

On failure, Docker logs are exported as a workflow artifact.

---

## 📁 Repository Layout

```text
services/
  analytics/
  appeal/
  audit/
  customer/
  decision/
  detect_fraud/
  fraud_score/
  gateway/
  notification/
  process_flagged_appeals/
  transaction/

ui/
  js/
  assets/
  banking.html
  staff-login.html
  fraud-review.html
  manager.html

testing/
  smoke-health.mjs
  service-contracts.mjs
  e2e-platform.mjs
  full-platform-journey.mjs
  postman/
  unit/
  unit_py/
```

---

## 📝 Operational Notes

- `https://localhost` uses a self-signed certificate locally
- analytics projections are rebuilt from fresh events in local/demo-style runs
- Mailpit is intentionally retained for OTP retrieval and demos
- Twilio trial accounts may still restrict SMS delivery to verified recipient numbers
- for a truly clean environment reset, use `docker compose down -v --remove-orphans`
