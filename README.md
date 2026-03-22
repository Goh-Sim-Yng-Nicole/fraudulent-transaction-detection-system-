# FTDS - Fraudulent Transaction Detection System

A microservices-based banking platform with real-time fraud detection, Kafka event streaming, audited decision trails, and separate user interfaces for customers, fraud analysts, and banking managers.

---

## Architecture Overview

```text
Static UIs (banking.html, staff-login.html, fraud-review.html, manager.html)
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

Protected observability
  -> Nginx role-aware reverse proxy :3000/:9090/:9091/:16686/:8025
  -> Grafana <- Prometheus <- cAdvisor
  -> Jaeger <- OpenTelemetry Collector :4317/:4318
  -> Mailpit (local email inbox) / :1025 (local SMTP)
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

| Service                   | Runtime           | Type      | Port | Description                                                                                                                                             |
| ------------------------- | ----------------- | --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customer`                | Python / FastAPI  | Atomic    | 8005 | Registration, login, OTP, profile management                                                                                                            |
| `transaction`             | Python / FastAPI  | Atomic    | 8000 | Transaction lifecycle and Kafka-driven status updates                                                                                                   |
| `fraud_score`             | Node.js / Express | Atomic    | 8001 | ML fraud scoring via Random Forest                                                                                                                      |
| `detect_fraud`            | Python / FastAPI  | Composite | 8008 | Orchestrates fraud scoring, publishes `transaction.scored`, hands off to OutSystems when configured, and provides a Docker-safe local decision fallback |
| `process_flagged_appeals` | Node.js / Express | Composite | 8002 | Fraud review service with legacy analyst routes, modern `/api/v1/review-cases` and `/api/v1/reviews` APIs, and the analyst dashboard                    |
| `appeal`                  | Node.js / Express | Atomic    | 8003 | Customer appeal lifecycle                                                                                                                               |
| `notification`            | Node.js / Express | Atomic    | 8010 | Event-driven notifications with local Mailpit SMTP by default in Docker, plus optional external SMTP/Twilio integrations                                |
| `audit`                   | Node.js / Express | Atomic    | 8007 | Structured audit log with query APIs, Prometheus metrics, and chain-integrity verification                                                              |
| `analytics`               | Node.js / Express | Atomic    | 8006 | Real-time manager analytics with dashboard APIs, WebSocket updates, and in-memory fallback when Redis is disabled                                       |
| `gateway`                 | Node.js / Express | Composite | 8004 | Customer-facing API aggregation with legacy customer routes, modern `/api/v1` proxies, and optional external decision proxying                          |

Active runtime ownership:

- Python services: `customer`, `transaction`, `detect_fraud`
- Node.js services: `fraud_score`, `process_flagged_appeals`, `appeal`, `notification`, `audit`, `analytics`, `gateway`
- External decisioning: OutSystems

The checked-in service folders now match the live Docker runtimes directly. `transaction` and `detect_fraud` no longer carry inactive duplicate Node implementations in this repo.

---

## UIs

| UI                  | File                   | Audience         | Access                                    |
| ------------------- | ---------------------- | ---------------- | ----------------------------------------- |
| Banking Portal      | `ui/banking.html`      | Customers        | `http://localhost:8088/banking.html`      |
| Staff Sign-In       | `ui/staff-login.html`  | Staff and ops    | `http://localhost:8088/staff-login.html`  |
| Fraud Review Portal | `ui/fraud-review.html` | Fraud analysts   | `http://localhost:8088/fraud-review.html` |
| Manager Dashboard   | `ui/manager.html`      | Managers and ops | `http://localhost:8088/manager.html`      |

### Staff Roles

- `fraud_analyst`: claim and decide flagged reviews and appeals
- `fraud_manager`: review operations plus analytics and audit access
- `ops_readonly`: read-only access to observability, analytics, and audit
- `ops_admin`: observability admin access plus Mailpit inbox access

### Case Ownership and Accountability

- Flagged review cases now record `claimed_by`, `claimed_role`, `claimed_at`, `reviewed_by`, `reviewed_role`, and `reviewed_at`
- Appeal cases now record `claimed_by`, `claimed_role`, `claimed_at`, `resolved_by`, `resolved_role`, and `resolved_at`
- Review and appeal event histories now track the acting role so claim, release, reassignment, and final decisions are attributable in the APIs and UI

---

## Infrastructure

| Component               | Port                                     | Purpose                                                       |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| Nginx                   | 8088                                     | Static UI files and reverse proxy                             |
| Kong                    | 80 (proxy)                               | API gateway, JWT auth, rate limiting                          |
| Redpanda (Kafka)        | 19092 (external), 9092 (internal)        | Event streaming                                               |
| Grafana                 | 3000 via Nginx                           | Monitoring dashboards, protected behind staff auth            |
| Prometheus              | 9090 via Nginx                           | Metrics scraping UI, protected behind staff auth              |
| Jaeger                  | 16686 via Nginx                          | Distributed tracing UI, protected behind staff auth           |
| OpenTelemetry Collector | 4317 (gRPC), 4318 (HTTP), 13133 (health) | Trace ingestion and span-to-metrics pipeline                  |
| Mailpit                 | 8025 via Nginx (UI), 1025 (SMTP)         | Protected local email inbox and SMTP server for notifications |
| cAdvisor                | 9091 via Nginx                           | Container metrics for Prometheus and Grafana                  |

---

## Kafka Topics

| Topic                   | Produced by                               | Consumed by                                                          |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `transaction.created`   | transaction                               | detect_fraud, audit                                                  |
| `transaction.scored`    | detect_fraud                              | OutSystems decision flow, audit                                      |
| `transaction.flagged`   | OutSystems or detect_fraud local fallback | transaction, process_flagged_appeals, notification, audit, analytics |
| `transaction.finalised` | OutSystems or detect_fraud local fallback | transaction, notification, audit, analytics                          |
| `transaction.reviewed`  | process_flagged_appeals                   | transaction, notification, audit, analytics                          |
| `appeal.created`        | appeal                                    | process_flagged_appeals, audit, analytics                            |
| `appeal.resolved`       | process_flagged_appeals                   | appeal, notification, audit, analytics                               |

---

## API Surface

The project currently exposes both legacy and versioned APIs:

- Customer-facing edge routes through Kong and Gateway, including `/api/auth`, `/api/customers`, `/api/customer/transactions`, and `/api/customer/appeals`
- Modern gateway proxy routes under `/api/v1`, including auth, transactions, analytics, audit, reviews, review cases, and appeals
- Fraud-review legacy analyst routes such as `/login`, `/flagged`, and `/appeals`
- Fraud-review modern routes such as `/api/v1/review-cases`, `/api/v1/reviews`, and `/api/v1/reviews/appeals`
- Appeal legacy routes under `/appeals` and modern routes under `/api/v1/appeals`
- Swagger/OpenAPI docs across the platform via FastAPI `/docs` plus `/api-docs` and `/api-docs.json` where applicable

Decision APIs are not hosted in this repo. The decision step belongs to OutSystems, and gateway decision proxy routes are enabled only when an external decision URL is configured.

---

## Decision Thresholds

These thresholds are applied by OutSystems in production, or by the `detect_fraud` local fallback during Docker development and automated testing when `OUTSYSTEMS_DECISION_URL` is unset.

| Score                                                       | Decision                  |
| ----------------------------------------------------------- | ------------------------- |
| 0 - `THRESHOLD_APPROVE_MAX` (default 49)                    | Auto APPROVED             |
| `THRESHOLD_FLAG_MIN` - `THRESHOLD_FLAG_MAX` (default 50-79) | FLAGGED for manual review |
| `THRESHOLD_DECLINE_MIN` - 100 (default 80-100)              | Auto REJECTED             |

---

## Credentials

| Persona / Portal     | Default Username | Default Password |
| -------------------- | ---------------- | ---------------- |
| Fraud analyst        | `analyst`        | `analyst123`     |
| Fraud manager        | `manager`        | `manager123`     |
| Ops readonly         | `opsviewer`      | `opsviewer123`   |
| Ops admin            | `opsadmin`       | `opsadmin123`    |
| Grafana (direct app) | `admin`          | `admin123`       |

Use the staff credentials on `staff-login.html` to access the protected fraud-review UI, manager UI, and observability stack. These credentials are for local Docker development only. Replace them outside local/demo environments.

---

## Quick Start

```bash
cp .env.example .env
docker compose up -d --build --remove-orphans
```

Default local access points:

- Banking portal: `http://localhost:8088/banking.html`
- Staff sign-in: `http://localhost:8088/staff-login.html`
- Fraud review portal: `http://localhost:8088/fraud-review.html`
- Manager dashboard: `http://localhost:8088/manager.html`
- Public edge through Kong: `http://localhost/`
- Grafana: `http://localhost:3000` (protected by staff auth and opens directly to the `Fraud Detection Platform` dashboard in local Docker)
- Prometheus: `http://localhost:9090` (protected by staff auth)
- Jaeger: `http://localhost:16686` (protected by staff auth)
- Mailpit inbox: `http://localhost:8025` (protected by `ops_admin`)

Local Docker defaults worth knowing:

- `analytics` runs with `REDIS_DISABLED=true`, so projections use the in-memory fallback store in local Docker
- `notification` uses Mailpit-backed SMTP by default in local Docker, so flagged-event emails are delivered to the local inbox instead of being mocked
- `customer` OTP emails can also be delivered to Mailpit in local Docker via the `CUSTOMER_SMTP_*` settings
- OutSystems decisioning is optional locally; when `OUTSYSTEMS_DECISION_URL` is blank, `detect_fraud` performs the local fallback decision flow
- Grafana auto-provisions the `Fraud Detection Platform` and `Tracing Operations` dashboards on startup, and the root Grafana URL opens the platform dashboard by default
- Jaeger receives traces from the full application path in local Docker, including `customer`, `transaction`, `fraud-score`, `detect-fraud`, `fraud-review`, `appeal`, `notification`, `audit`, `analytics`, and `gateway`
- Nginx now acts as the role-aware ingress for staff UI pages and observability tools, while internal service ports stay on the Docker network unless explicitly published for local dev APIs

---

## Runtime Security

The repo now keeps local development convenient while allowing stricter runtime rules outside Docker demo mode.

Key points:

- Root and nested `.env` files are ignored by git, and service-local `.env` files are intentionally not committed.
- Copy [`.env.example`](C:/Users/Naren/Documents/SMU/y2s2/ESD/project2/fraudulent-transaction-detection-system-/.env.example) to `.env` for local Docker, then replace all demo credentials before any shared or production-like deployment.
- The local/demo `JWT_SECRET` in [`.env.example`](C:/Users/Naren/Documents/SMU/y2s2/ESD/project2/fraudulent-transaction-detection-system-/.env.example) intentionally matches Kong's declarative JWT credential in [`kong/kong.yml`](C:/Users/Naren/Documents/SMU/y2s2/ESD/project2/fraudulent-transaction-detection-system-/kong/kong.yml), so do not change only one of them in Docker-based environments.
- Set `SECURITY_ENFORCE_STRICT_CONFIG=true` in staging/production to make auth-bearing services reject demo secrets and weak dashboard credentials.
- Gateway now requires `JWT_SECRET` to be present, and strict mode rejects wildcard CORS plus known demo JWT secrets.
- The customer service also rejects demo JWT secrets in strict mode.
- Grafana anonymous access is now explicitly environment-controlled through `GRAFANA_ANONYMOUS_ENABLED`. Keep it enabled for local convenience only.
- Staff and ops access is now issued by the gateway as short-lived signed sessions, and Nginx uses role-aware `auth_request` checks before serving protected UI pages or observability tools.
- Observability UIs are no longer intended to be exposed directly; access should go through the authenticated Nginx reverse proxy.
- When validating Compose locally, prefer `docker compose config -q` so you do not print fully resolved environment values to your terminal history.

---

## Automated Testing

The repo includes four automated validation layers under `testing/`.

The unit layer now follows the live runtimes directly:

- Python `unittest` covers the active Python `transaction` and `detect_fraud` services
- Node `node:test` covers the active Node analytics projection logic
- the contracts layer also verifies Jaeger's `/api/services` output so missing traced services are caught automatically

| Command                  | Purpose                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:unit`      | Focused Python and Node unit tests for fraud decisioning, transaction idempotent publish flow, and analytics projections |
| `npm run test:smoke`     | Fast availability check across the main service surfaces                                                                 |
| `npm run test:contracts` | Direct service and infrastructure validation across APIs, dashboards, Kafka, and observability                           |
| `npm run test:e2e`       | Full customer-to-analyst-to-appeal flow with OTP, manual review, analytics, audit, and notification verification         |
| `npm run test:verify`    | Runs `unit -> smoke -> contracts -> e2e` in sequence                                                                     |

On Windows PowerShell, use `npm.cmd` if `npm` is blocked by execution policy:

```powershell
npm.cmd run test:unit
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

## Continuous Integration

The repo now includes a GitHub Actions workflow at [`.github/workflows/ci.yml`](C:/Users/Naren/Documents/SMU/y2s2/ESD/project2/fraudulent-transaction-detection-system-/.github/workflows/ci.yml).

On every push, pull request, or manual dispatch, CI will:

- copy `.env.example` to `.env` for a clean runner bootstrap
- install the shared root linting and formatting toolchain
- install `ruff` for Python quality checks
- run `npm run quality`
- run `npm run test:unit`
- validate the Docker Compose configuration
- build the full application stack
- start the stack in Docker
- run `test:smoke`, `test:contracts`, and `test:e2e` as separate gates
- print `docker compose ps`
- upload Docker logs automatically if the run fails

This keeps the submitted/demo version reproducible and catches cross-service regressions before they reach your main branch.

---

## Code Quality

The repo now has a shared root-level quality gate so the mixed Node and Python services follow one baseline.

Available commands:

- `npm run lint:js` for repo-wide JavaScript and test-script linting with ESLint
- `npm run lint:py` for the Python services and Python unit tests with Ruff
- `npm run lint` to run both lint layers
- `npm run format:check` to validate shared repo config and documentation formatting with Prettier
- `npm run format:write` to apply the standard formatting to those files
- `npm run quality` to run the full code-quality gate locally

For Python quality checks, install the local dev dependency once:

```powershell
python -m pip install -r requirements-dev.txt
```

For Node quality checks, install the root dev dependencies once:

```powershell
npm.cmd install
```

The shared standards are defined in:

- [`.editorconfig`](C:/Users/Naren/Documents/SMU/y2s2/ESD/project2/fraudulent-transaction-detection-system-/.editorconfig)
- [`eslint.config.mjs`](C:/Users/Naren/Documents/SMU/y2s2/ESD/project2/fraudulent-transaction-detection-system-/eslint.config.mjs)
- [`.prettierrc.json`](C:/Users/Naren/Documents/SMU/y2s2/ESD/project2/fraudulent-transaction-detection-system-/.prettierrc.json)
- [`pyproject.toml`](C:/Users/Naren/Documents/SMU/y2s2/ESD/project2/fraudulent-transaction-detection-system-/pyproject.toml)

---

## Test Coverage

### Smoke

- Customer, transaction, fraud-score, detect-fraud, fraud-review, appeal, analytics, audit, notification, gateway, and public edge health surfaces

### Contracts

- Customer: health, register, login, OTP verify, resend OTP, lookup by email and phone, internal contact lookup, profile get/update
- Transaction: create, list by query, list by `/transactions/customer/:customerId`, get by id, get decision, `PENDING -> FLAGGED -> APPROVED`
- Fraud score: `/docs`, `/model`, `/metrics`, `/api-docs.json`, `/score`, `/api/v1/score`
- Detect fraud: health plus event-driven scoring validation through real transaction creation
- Fraud review: protected staff login flow, root dashboard, legacy analyst queue, modern `/review-cases`, claim, release, resolve, `/reviews/pending`, `/reviews/:transactionId`, modern appeal-review endpoints, and ownership fields
- Appeal: legacy `/appeals`, modern `/api/v1/appeals`, `/appeals/customer/:customerId`, `/appeals/:appealId`, internal pending/claim/release/resolve endpoints, and ownership fields
- Analytics: legacy `/login` and `/dashboard`, modern `/api/v1/analytics/dashboard` and `/api/v1/analytics/realtime`, dashboard HTML on port `8006`
- Audit: `/api/v1/audit/transaction/:transactionId`, `/api/v1/audit/customer/:customerId`, `/api/v1/audit/stats`, `/api/v1/audit/verify`, `/api/v1/metrics`
- Notification: health, readiness, metrics, Kafka-consumption evidence through counters
- Gateway: health, `/api/v1/auth/login`, `/api/v1/transactions/customer/:customerId`, `/api-docs.json`
- Edge and infra: public edge, `banking.html`, protected `staff-login.html`, protected `fraud-review.html`, protected `manager.html`, protected Prometheus/Grafana/Jaeger/Mailpit/cAdvisor access, and provisioned dashboards
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
