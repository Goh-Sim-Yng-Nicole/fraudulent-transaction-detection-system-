# FTDS - Fraudulent Transaction Detection System

A microservices-based banking platform with real-time fraud detection, Kafka event streaming, audited decision trails, and separate user interfaces for customers, fraud analysts, and banking managers.

---

## Architecture Overview

```text
Static UIs (banking.html, fraud-review.html, manager.html)
  -> Nginx :8088
  -> Kong :80 (public edge)

Customer flows
  -> Gateway :8004
     -> Customer :8005
     -> Transaction :8000
     -> Appeal :8003
     -> Fraud Review :8002
     -> Analytics :8006
     -> Audit :8007

Fraud scoring and decisions
  -> Detect Fraud :8008
     -> Fraud Score :8001
     -> OutSystems decision service (external, optional)
     -> Local fallback when OutSystems is unset

Observability
  -> Grafana :3000 <- Prometheus :9090 <- cAdvisor :9091
```

### Event Flow

```text
[Customer] -> Gateway / Transaction Service
  -> transaction.created
    -> detect_fraud
       -> fraud_score
       -> transaction.scored
       -> OutSystems decision handoff when OUTSYSTEMS_DECISION_URL is set
       -> otherwise local fallback emits:
          -> transaction.finalised -> transaction, notification, audit, analytics
          -> transaction.flagged   -> transaction, fraud-review, notification, audit, analytics
             -> analyst review     -> transaction.reviewed -> transaction, notification, audit, analytics
             -> customer appeal    -> appeal.created -> fraud-review, audit, analytics
                -> appeal resolved -> appeal.resolved -> appeal, notification, audit, analytics
```

---

## Services

| Service | Type | Port | Description |
|---|---|---|---|
| `customer` | Atomic | 8005 | Registration, login, OTP, profile management |
| `transaction` | Atomic | 8000 | Transaction lifecycle and Kafka-driven status updates |
| `fraud_score` | Atomic | 8001 | ML fraud scoring via Random Forest |
| `detect_fraud` | Composite | 8008 | Orchestrates fraud scoring, publishes `transaction.scored`, hands off to OutSystems when configured, and provides a Docker-safe local decision fallback |
| `process_flagged_appeals` | Composite | 8002 | Fraud review service with legacy analyst routes, modern `/api/v1/review-cases` and `/api/v1/reviews` APIs, and the analyst dashboard |
| `appeal` | Atomic | 8003 | Customer appeal lifecycle |
| `notification` | Atomic | 8010 | Event-driven notifications with mock email enabled in local Docker and optional SMTP/Twilio integrations |
| `audit` | Atomic | 8007 | Structured audit log with query APIs, Prometheus metrics, and chain-integrity verification |
| `analytics` | Atomic | 8006 | Real-time manager analytics with dashboard APIs, WebSocket updates, and in-memory fallback when Redis is disabled |
| `gateway` | Composite | 8004 | Customer-facing API aggregation with legacy customer routes, modern `/api/v1` proxies, and optional external decision proxying |

---

## UIs

| UI | File | Audience | Access |
|---|---|---|---|
| Banking Portal | `ui/banking.html` | Customers | `http://localhost:8088/banking.html` |
| Fraud Review Portal | `ui/fraud-review.html` | Fraud analysts | `http://localhost:8088/fraud-review.html` |
| Manager Dashboard | `ui/manager.html` | Banking managers | `http://localhost:8088/manager.html` |

---

## Infrastructure

| Component | Port | Purpose |
|---|---|---|
| Nginx | 8088 | Static UI files and reverse proxy |
| Kong | 80 (proxy), 8090 (admin) | API gateway, JWT auth, rate limiting |
| Redpanda (Kafka) | 19092 (external), 9092 (internal) | Event streaming |
| Grafana | 3000 | Monitoring dashboards |
| Prometheus | 9090 | Metrics scraping |
| cAdvisor | 9091 | Container metrics for Prometheus and Grafana |

---

## Kafka Topics

| Topic | Produced by | Consumed by |
|---|---|---|
| `transaction.created` | transaction | detect_fraud, audit |
| `transaction.scored` | detect_fraud | OutSystems decision flow, audit |
| `transaction.flagged` | OutSystems or detect_fraud local fallback | transaction, process_flagged_appeals, notification, audit, analytics |
| `transaction.finalised` | OutSystems or detect_fraud local fallback | transaction, notification, audit, analytics |
| `transaction.reviewed` | process_flagged_appeals | transaction, notification, audit, analytics |
| `appeal.created` | appeal | process_flagged_appeals, audit, analytics |
| `appeal.resolved` | process_flagged_appeals | appeal, notification, audit, analytics |

---

## API Surface

The project currently exposes both legacy and versioned APIs:

- Customer-facing edge routes through Kong and Gateway, including `/api/auth`, `/api/customers`, `/api/customer/transactions`, and `/api/customer/appeals`
- Modern gateway proxy routes under `/api/v1`, including auth, transactions, analytics, audit, reviews, review cases, and appeals
- Fraud-review legacy analyst routes such as `/login`, `/flagged`, and `/appeals`
- Fraud-review modern routes such as `/api/v1/review-cases`, `/api/v1/reviews`, and `/api/v1/reviews/appeals`
- Appeal legacy routes under `/appeals` and modern routes under `/api/v1/appeals`
- Swagger/OpenAPI docs on the gateway and the Node-based services via `/api-docs` and `/api-docs.json`

Decision APIs are not hosted in this repo. The decision step belongs to OutSystems, and gateway decision proxy routes are enabled only when an external decision URL is configured.

---

## Decision Thresholds

These thresholds are applied by OutSystems in production, or by the `detect_fraud` local fallback during Docker development and automated testing when `OUTSYSTEMS_DECISION_URL` is unset.

| Score | Decision |
|---|---|
| 0 - `THRESHOLD_APPROVE_MAX` (default 49) | Auto APPROVED |
| `THRESHOLD_FLAG_MIN` - `THRESHOLD_FLAG_MAX` (default 50-79) | FLAGGED for manual review |
| `THRESHOLD_DECLINE_MIN` - 100 (default 80-100) | Auto REJECTED |

---

## Credentials

| Portal | Default Username | Default Password |
|---|---|---|
| Fraud Review | `analyst` | `analyst123` |
| Manager Dashboard | `manager` | `manager123` |
| Grafana | `admin` | `admin123` |

---

## Quick Start

```bash
cp .env.example .env
docker compose up -d --build --remove-orphans
```

Default local access points:

- Banking portal: `http://localhost:8088/banking.html`
- Fraud review portal: `http://localhost:8088/fraud-review.html`
- Manager dashboard: `http://localhost:8088/manager.html`
- Public edge through Kong: `http://localhost/`
- Kong admin: `http://localhost:8090/status`
- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9090`

Local Docker defaults worth knowing:

- `analytics` runs with `REDIS_DISABLED=true`, so projections use the in-memory fallback store in local Docker
- `notification` enables mock email for flagged-event readiness in local Docker
- OutSystems decisioning is optional locally; when `OUTSYSTEMS_DECISION_URL` is blank, `detect_fraud` performs the local fallback decision flow

---

## Automated Testing

The repo includes three automated validation layers under `testing/`:

| Command | Purpose |
|---|---|
| `npm run test:smoke` | Fast availability check across the main service surfaces |
| `npm run test:contracts` | Direct service and infrastructure validation across APIs, dashboards, Kafka, and observability |
| `npm run test:e2e` | Full customer-to-analyst-to-appeal flow with OTP, manual review, analytics, audit, and notification verification |
| `npm run test:verify` | Runs `smoke -> contracts -> e2e` in sequence |

On Windows PowerShell, use `npm.cmd` if `npm` is blocked by execution policy:

```powershell
npm.cmd run test:smoke
npm.cmd run test:contracts
npm.cmd run test:e2e
npm.cmd run test:verify
```

Recommended local validation flow:

```powershell
docker compose up -d --build --remove-orphans
npm.cmd run test:verify
```

---

## Test Coverage

### Smoke

- Customer, transaction, fraud-score, detect-fraud, fraud-review, appeal, analytics, audit, notification, gateway, and public edge health surfaces

### Contracts

- Customer: health, register, login, OTP verify, resend OTP, lookup by email and phone, internal contact lookup, profile get/update
- Transaction: create, list by query, list by `/transactions/customer/:customerId`, get by id, get decision, `PENDING -> FLAGGED -> APPROVED`
- Fraud score: `/docs`, `/model`, `/metrics`, `/api-docs.json`, `/score`, `/api/v1/score`
- Detect fraud: health plus event-driven scoring validation through real transaction creation
- Fraud review: root dashboard, legacy analyst queue, modern `/review-cases`, claim, release, resolve, `/reviews/pending`, `/reviews/:transactionId`, modern appeal-review endpoints
- Appeal: legacy `/appeals`, modern `/api/v1/appeals`, `/appeals/customer/:customerId`, `/appeals/:appealId`, internal pending and resolve endpoints
- Analytics: legacy `/login` and `/dashboard`, modern `/api/v1/analytics/dashboard` and `/api/v1/analytics/realtime`, dashboard HTML on port `8006`
- Audit: `/api/v1/audit/transaction/:transactionId`, `/api/v1/audit/customer/:customerId`, `/api/v1/audit/stats`, `/api/v1/audit/verify`, `/api/v1/metrics`
- Notification: health, readiness, metrics, Kafka-consumption evidence through counters
- Gateway: health, `/api/v1/auth/login`, `/api/v1/transactions/customer/:customerId`, `/api-docs.json`
- Edge and infra: public edge, `banking.html`, `fraud-review.html`, `manager.html`, Kong admin status, Prometheus readiness, Grafana health, cAdvisor health
- Kafka: required topics exist and all core consumer groups settle with `TOTAL-LAG 0`

### End To End

- Customer registration through the public edge
- OTP verification using a real OTP fetched from `postgres-customer`
- Sensitive-operation OTP flow
- Password change and re-login with the rotated password
- Lifecycle account deletion and confirmation that the deleted account can no longer be used
- Flagged transaction resolved through the legacy analyst flow
- Flagged transaction resolved through the modern review-case flow
- Customer appeal created and resolved through the modern appeal-review flow
- Analytics dashboard updates validated after the same run
- Audit trail recorded for the appealed transaction
- Notification readiness and Kafka consumer completion verified
