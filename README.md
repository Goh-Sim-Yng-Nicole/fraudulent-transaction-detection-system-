# FTDS - Fraudulent Transaction Detection System

FTDS is a Docker-based microservices platform for banking transactions, fraud scoring, analyst review, appeals, audit logging, analytics, and observability.

It is built to demonstrate an end-to-end fraud workflow:

- customers register, log in with OTP, and submit transactions
- suspicious transactions are flagged for analyst review
- analysts claim and decide cases
- customers can appeal rejected outcomes
- managers monitor fraud and appeal outcomes
- ops users access Grafana, Jaeger, Prometheus, cAdvisor, and Mailpit through protected ingress

## What The Project Does

- Customer banking flow with OTP-based sign-in
- Transaction service with Kafka-backed status updates
- Fraud scoring and fraud orchestration
- Manual review queue with claim / release / decision ownership
- Appeal flow with ownership and auditability
- Analytics dashboard for fraud managers
- Audit trail APIs with integrity verification
- Notification service with local SMTP via Mailpit
- Observability with Grafana, Prometheus, Jaeger, cAdvisor, and OpenTelemetry
- Role-aware ingress for staff and ops through Nginx

## Core Architecture

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

Fraud pipeline:
  Transaction
    -> transaction.created
    -> detect_fraud
    -> fraud_score
    -> transaction.scored
    -> decision (local Kafka consumer)
    -> optional OutSystems decision handoff modes

Decision events:
  -> transaction.flagged
  -> transaction.finalised
  -> transaction.reviewed
  -> appeal.created
  -> appeal.resolved

Observability:
  -> OpenTelemetry Collector
  -> Jaeger
  -> Prometheus
  -> Grafana
  -> cAdvisor
```

## Services

| Service        | Runtime          | Port | Purpose                                                                       |
| -------------- | ---------------- | ---- | ----------------------------------------------------------------------------- |
| `customer`     | Python / FastAPI | 8005 | Registration, OTP auth, profile, sensitive account actions                    |
| `transaction`  | Python / FastAPI | 8000 | Transaction creation, listing, status, Kafka-driven updates                   |
| `fraud_score`  | Node / Express   | 8001 | ML scoring endpoint                                                           |
| `detect_fraud` | Python           | 8008 | Rules + ML orchestration, emits `transaction.scored`                          |
| `decision` | Node / Express | 3005 | Consumes scored events, persists decisions, emits `transaction.flagged/finalised` |
| `fraud-review` | Node / Express   | 8002 | Flagged review queue and appeal review queue                                  |
| `appeal`       | Node / Express   | 8003 | Customer appeals                                                              |
| `analytics`    | Node / Express   | 8006 | Manager metrics and realtime dashboard data                                   |
| `audit`        | Node / Express   | 8007 | Audit event storage and verification                                          |
| `notification` | Node / Express   | 8010 | Email / notification processing                                               |
| `gateway`      | Node / Express   | 8004 | Public API aggregation and staff auth                                         |

Docker Compose now includes a local standalone `decision` service.

`detect_fraud` now supports 3 modes:

- `local`: score and decide locally for Docker dev and automated tests
- `outsystems_http`: score locally, then call an external OutSystems decision API
- `outsystems_kafka`: score locally, publish `transaction.scored`, and wait for a Kafka consumer (the in-repo `decision` by default, or an external OutSystems consumer) to publish `transaction.flagged` or `transaction.finalised`

For the Kafka decision architecture (now the default Docker setup), use:

```env
DECISION_INTEGRATION_MODE=outsystems_kafka
ENABLE_LOCAL_DECISION_FALLBACK=false
OUTSYSTEMS_DECISION_URL=
```

In that mode, the decision consumer is expected to:

1. consume `transaction.scored`
2. persist its own decision record internally
3. publish either `transaction.flagged` or `transaction.finalised`

Local Docker can now run fully self-contained using `outsystems_kafka` with the in-repo `decision`.

## UI And Access

### Main URLs

- Banking portal: [http://localhost:8088/banking.html](http://localhost:8088/banking.html)
- Staff sign-in: [http://localhost:8088/staff-login.html](http://localhost:8088/staff-login.html)
- Fraud review UI: [http://localhost:8088/fraud-review.html](http://localhost:8088/fraud-review.html)
- Manager dashboard: [http://localhost:8088/manager.html](http://localhost:8088/manager.html)
- Public edge root: [http://localhost/](http://localhost/)
- HTTPS localhost ingress: [https://localhost/staff-login.html](https://localhost/staff-login.html)

### Staff Roles

| Role            | Default Login                | Access                                                   |
| --------------- | ---------------------------- | -------------------------------------------------------- |
| `fraud_analyst` | `analyst` / `analyst123`     | Fraud review UI, flagged cases, appeal review            |
| `fraud_manager` | `manager` / `manager123`     | Fraud review UI, manager dashboard                       |
| `ops_readonly`  | `opsviewer` / `opsviewer123` | Manager dashboard, Grafana, Jaeger, Prometheus, cAdvisor |
| `ops_admin`     | `opsadmin` / `opsadmin123`   | Everything ops-readonly can access, plus Mailpit         |

These credentials are for local/demo use only.

### Protected Observability URLs

- Grafana: [http://localhost:3000](http://localhost:3000)
- Jaeger: [http://localhost:16686](http://localhost:16686)
- Prometheus: [http://localhost:9090](http://localhost:9090)
- cAdvisor: [http://localhost:9091](http://localhost:9091)
- Mailpit: [http://localhost:8025](http://localhost:8025)

These routes are served behind the Nginx reverse proxy and are intended for staff / ops access, not customers.

## Case Ownership

Flagged review cases and appeals both track who touched them.

The platform records:

- who claimed the case
- the role they had
- when they claimed it
- who made the final decision
- the role they had when deciding
- notes / reasons for the final outcome

This is visible in the review APIs and reflected in the UI.

## Quick Start

### 1. Create your env file

```powershell
Copy-Item .env.example .env
```

### 2. Start the full stack

```powershell
docker compose up -d --build --remove-orphans
```

### 3. Open the main entry points

- Customer: [http://localhost:8088/banking.html](http://localhost:8088/banking.html)
- Staff: [http://localhost:8088/staff-login.html](http://localhost:8088/staff-login.html)
- HTTPS rehearsal: [https://localhost/staff-login.html](https://localhost/staff-login.html)

## Demo Guide

This is the easiest way to demo the project end to end.

### Customer Demo

1. Open [http://localhost:8088/banking.html](http://localhost:8088/banking.html).
2. Register a new customer account (or choose Google OAuth if configured).
3. When prompted for OTP, open Mailpit at [http://localhost:8025](http://localhost:8025) and read the latest OTP email.
4. Verify the OTP to enter the banking portal.

### Submit A Normal Transaction

Use the new transaction form in the banking portal.

Example values:

- recipient type: `Pay Merchant (UEN)`
- merchant ID: `FTDS_NORMAL_DEMO`
- amount: `120.50`
- currency: `SGD`
- card type: `CREDIT`
- country: `SG`

### Submit A Flagged Transaction

Use these values to reliably create a flagged case in the current local stack:

- recipient type: `Pay Merchant (UEN)`
- merchant ID: `FTDS_FLAGGED_DEMO`
- amount: `3200`
- currency: `USD`
- card type: `PREPAID`
- country: `NG`

After a short delay, the transaction should move from `PENDING` to `FLAGGED`.

### Analyst Review Demo

1. Sign in at [http://localhost:8088/staff-login.html](http://localhost:8088/staff-login.html) as:
   `analyst` / `analyst123`
2. Open [http://localhost:8088/fraud-review.html](http://localhost:8088/fraud-review.html).
3. Claim the flagged case.
4. Approve or reject it.

If you reject it, the customer will see the transaction become `REJECTED`.

### Appeal Demo

1. Reject a flagged transaction in the analyst UI.
2. Go back to the customer banking portal.
3. Open the rejected transaction and submit an appeal.
4. Return to the analyst UI.
5. Claim the appeal and resolve it.

### Manager Demo

1. Sign in as `manager` / `manager123`.
2. Open [http://localhost:8088/manager.html](http://localhost:8088/manager.html).
3. Show:
   - transaction totals
   - approval / decline rates
   - manual reviews
   - appeal counts
   - realtime decision quality metrics

### Ops Demo

1. Sign in as `opsviewer` or `opsadmin`.
2. Open the manager dashboard and the observability links.
3. Show:
   - Grafana dashboards
   - Jaeger service traces
   - Prometheus targets / metrics
   - cAdvisor container metrics
   - Mailpit inbox with OTP and alert emails

## Testing

### Available Commands

From the repo root:

```powershell
npm.cmd run test:unit
npm.cmd run test:smoke
npm.cmd run test:contracts
npm.cmd run test:e2e
npm.cmd run test:verify
```

`test:verify` runs:

```text
unit -> smoke -> contracts -> e2e
```

### What The Tests Cover

- Unit tests for active Python fraud and transaction logic, plus Node analytics logic
- Smoke checks across all major service surfaces
- Contract checks for APIs, protected UIs, observability endpoints, Kafka topics, and consumer lag
- Full end-to-end flow for:
  - registration
  - OTP verification
  - password rotation
  - account deletion
  - flagged transaction review
  - appeal creation and resolution
  - analytics updates
  - audit trail presence

### Recommended Verification Flow

```powershell
docker compose up -d --build --remove-orphans
npm.cmd run test:verify
```

## CI And Code Quality

### CI

GitHub Actions runs:

- `npm run quality`
- `npm run test:unit`
- Docker Compose validation
- full-stack build
- `test:smoke`
- `test:contracts`
- `test:e2e`

The workflow lives at [`.github/workflows/ci.yml`](C:/Users/Naren/Documents/SMU/y2s2/ESD/project2/fraudulent-transaction-detection-system-/.github/workflows/ci.yml).

### Local Quality Commands

```powershell
npm.cmd run lint:js
python -m ruff check services/customer services/transaction services/detect_fraud ftds testing/unit_py
npm.cmd run format:check
npm.cmd run quality
```

## Security And Local Deployment Notes

- Nginx acts as the role-aware reverse proxy for staff pages and observability tools.
- `https://localhost` uses a self-signed certificate for local rehearsal, so your browser will warn until you trust the cert.
- Kong is the public API edge on port `80`.
- Staff sessions are signed by the gateway and checked again by Nginx for protected pages.
- Local Mailpit is used for OTP and notification email delivery.
- Analytics currently runs with in-memory projections when Redis is disabled, so metrics reset if the analytics container is recreated.
- Keep the default local credentials only for local development.

## Repo Structure

```text
services/
  customer/
  transaction/
  fraud_score/
  detect_fraud/
  decision/
  process_flagged_appeals/
  appeal/
  analytics/
  audit/
  notification/
  gateway/

ui/
  banking.html
  staff-login.html
  fraud-review.html
  manager.html
  forbidden.html

testing/
  smoke-health.mjs
  service-contracts.mjs
  e2e-platform.mjs
  unit/
  unit_py/
```

## Helpful Notes

- OTPs are delivered to Mailpit at [http://localhost:8025](http://localhost:8025).
- A self-signed cert warning on `https://localhost` is expected locally.
- If the manager dashboard looks stale after a rebuild, refresh after new events are generated.
- If OutSystems is connected, decisioning can be handed off externally by switching `DECISION_INTEGRATION_MODE`.


