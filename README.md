# Fraudulent Transaction Detection System (FTDS)

A microservices-based banking platform that detects and mitigates fraudulent financial transactions using rule-based and machine learning techniques, real-time Kafka event processing, and human review / appeal workflows. Developed as an academic project.

---

## Architecture Overview

```
Customer Banking UI  ──►  Nginx (port 80)  ──►  Gateway (BFF, port 8004)
                                │
                                ├──► Customer Service   (port 8005)
                                ├──► Transaction Service (port 8000)
                                ├──► Fraud Review Service (port 8002)
                                └──► Appeal Service      (port 8003)

Transaction Service ──(transaction.created)──► Detect Fraud (composite)
                                                    │
                                                    └──► Fraud Score (port 8001)
                                                    │
                                              (transaction.scored)
                                                    │
                                               Decision Service
                                              ╱              ╲
                               (transaction.finalised)  (transaction.flagged)
                                        │                       │
                           ┌────────────┴──────────┐   Process Flagged & Appeals
                       Notification             Transaction       (port 8002)
                       Audit                   Service           │
                       Analytics               update status  (transaction.reviewed / appeal.resolved)
```

### Service Classification

| Type | Services |
|---|---|
| **User Interface** | Customer Banking UI (Nginx) |
| **Composite Services** | Gateway (BFF), Detect Fraud, Process Flagged & Appeals |
| **Atomic Microservices** | Customer, Transaction, Fraud Score, Decision, Notification, Audit, Analytics, Appeal |
| **Infrastructure** | Redpanda (Kafka), PostgreSQL ×4 |

---

## Services

| Service | Port | Tech | Description |
|---|---|---|---|
| Customer | 8005 | Python / FastAPI | Registration, login (OTP), JWT auth, profile |
| Transaction | 8000 | Python / FastAPI | Transaction lifecycle & status tracking |
| Fraud Score | 8001 | Node.js / Express | ML + rule-based fraud probability scoring |
| Decision | — | Python worker | Classifies scored transactions (approve / flag / reject) |
| Detect Fraud | — | Python worker | Composite: receives events, calls Fraud Score, emits score |
| Process Flagged & Appeals | 8002 | Python / FastAPI | Composite: fraud team review of flagged cases and appeals |
| Appeal | 8003 | Python / FastAPI | Customer appeal submission and status tracking |
| Notification | — | Python worker | Emails + SMS to customers on every key event |
| Audit | — | Python worker | Structured audit trail of every event |
| Analytics | — | Python worker | In-memory dashboard metrics by outcome |
| Gateway | 8004 | Python / FastAPI | BFF — composes and proxies all customer-facing API calls |
| Nginx | 80 | Nginx | Reverse proxy + static file server for the UI |

---

## Event Flow (Kafka Topics)

```
transaction.created   → Detect Fraud → transaction.scored
transaction.scored    → Decision     → transaction.finalised  (score ≤ 40)
                                     → transaction.flagged    (40 < score ≤ 70)
                                     → transaction.finalised  (score > 70, REJECTED)

transaction.flagged   → Process Flagged & Appeals (create manual review case)
                      → Notification, Audit, Analytics

transaction.finalised → Transaction (update status)
                      → Notification (notify sender + P2P recipient if APPROVED)
                      → Audit, Analytics

transaction.reviewed  → Transaction (update status to RESOLVED)
                      → Notification, Audit, Analytics

appeal.created        → Process Flagged & Appeals (add to review inbox)
                      → Audit

appeal.resolved       → Transaction (update status to RESOLVED)
                      → Appeal (update local record)
                      → Notification, Audit, Analytics
```

---

## Quickstart (Docker)

**Prerequisites:** Docker Desktop

```bash
# 1. Copy environment file
cp .env.example .env
# Fill in TWILIO_* and SMTP_* values if you want real SMS/email.

# 2. Start all services
docker compose up --build

# 3. Open the customer portal
open http://localhost
```

### Databases

Each service has its own isolated PostgreSQL instance:

| Database | External Port | Default DB |
|---|---|---|
| Transaction | 5432 | `ftds_transaction` |
| Appeal | 5433 | `ftds_appeal` |
| Fraud Review | 5434 | `ftds_fraud_review` |
| Customer | 5435 | `ftds_customer` |

Default credentials: `postgres` / `postgres`. Tables are auto-created by dedicated `*-migrate` containers on first start.

---

## Environment Variables

Key variables in `.env` (see `.env.example` for full list):

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID for SMS (optional — logs to console if unset) |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | Twilio sender phone number |
| `SMTP_HOST` / `SMTP_PORT` | SMTP server for OTP and notification emails |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP credentials |
| `JWT_SECRET` | Secret for signing customer JWT tokens |
| `APPROVE_MAX_SCORE` | Fraud score threshold below which transactions are auto-approved (default: 40) |
| `FLAG_MAX_SCORE` | Fraud score threshold below which transactions are flagged (default: 70; above → rejected) |

---

## Key Scenarios

### Scenario 1 — Auto approve / reject
1. Customer submits a transaction via the UI
2. Detect Fraud requests a fraud score from Fraud Score
3. Decision publishes `transaction.finalised` (APPROVED or REJECTED)
4. Transaction service updates status; Notification emails the customer

### Scenario 2 — Flagged for manual review
1. Fraud score falls in the middle range → Decision publishes `transaction.flagged`
2. Process Flagged & Appeals stores the case for the fraud team
3. Fraud analyst reviews and resolves via the Fraud Review Team UI
4. `transaction.reviewed` is published; Transaction status becomes RESOLVED

### Scenario 3 — Customer appeal
1. Customer submits an appeal for a rejected/flagged transaction
2. `appeal.created` is consumed by Process Flagged & Appeals
3. Fraud analyst resolves the appeal; `appeal.resolved` is published
4. Transaction and Appeal services update their records; customer is notified

---

## Repository Layout

```
├── ftds/                        # Shared Python library (schemas, Kafka helpers, notifications)
├── services/
│   ├── analytics/               # Kafka worker — dashboard metrics
│   ├── appeal/                  # Atomic service — appeal CRUD + Kafka
│   ├── audit/                   # Kafka worker — structured audit trail
│   ├── customer/                # Atomic service — auth, profile
│   ├── decision/                # Kafka worker — score → approve/flag/reject
│   ├── detect_fraud/            # Composite worker — orchestrates fraud scoring
│   ├── fraud_score/             # Node.js ML scoring API
│   ├── gateway/                 # BFF — composes downstream calls
│   ├── notification/            # Kafka worker — email + SMS
│   ├── process_flagged_appeals/ # Composite service — fraud team review UI backend
│   └── transaction/             # Atomic service — transaction lifecycle
├── ui/                          # Vanilla JS + Bootstrap 5 frontend
├── nginx/                       # Reverse proxy config + Dockerfile
├── kong/                        # Kong gateway setup scripts (optional)
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

---

## Notes

- Kafka is exposed externally on `localhost:19092` (internal: `redpanda:9092`).
- Event contracts (schemas) are defined in `ftds/schemas.py`.
- Notification falls back to console logging when SMTP/Twilio is not configured.
- The `ftds/` package is copied into every Python service container — it is the single source of truth for shared types and helpers.
