# FTDS — Fraudulent Transaction Detection System

A microservices-based banking platform with real-time fraud detection, Kafka event streaming, and three separate UIs for customers, fraud analysts, and banking managers.

---

## Architecture Overview

```
Customer UI (banking.html)
  → Nginx :8088 → Kong :80 → Gateway :8004
                            → Customer :8005

Fraud Review UI (fraud-review.html) → Process Flagged & Appeals :8002
Manager Dashboard (manager.html)    → Analytics HTTP endpoint
Grafana :3000                       ← Prometheus :9090 ← cAdvisor
```

### Event Flow

```
[Customer] → POST /transaction
  → transaction.created
    → detect_fraud (composite)
        → fraud_score :8001 (ML score)
        → decision / OutSystems (threshold logic)
            → transaction.finalised  → transaction, notification, audit, analytics
            → transaction.flagged    → process_flagged_appeals, notification, audit, analytics
                → analyst resolves   → transaction.reviewed → transaction, notification, audit, analytics
                → customer appeals   → appeal.created → process_flagged_appeals, audit, analytics
                    → analyst resolves appeal → appeal.resolved → appeal, notification, audit, analytics
```

---

## Services

| Service | Type | Port | Description |
|---|---|---|---|
| `customer` | Atomic | 8005 | Registration, login, OTP, profile management |
| `transaction` | Atomic | 8000 | Transaction lifecycle, Kafka status updates |
| `fraud_score` | Atomic | 8001 | ML fraud scoring via Random Forest |
| `decision` | Atomic (→ OutSystems) | — | Threshold-based approve/flag/reject (being replaced by OutSystems) |
| `detect_fraud` | Composite | — | Orchestrates fraud_score + decision |
| `process_flagged_appeals` | Composite | 8002 | Analyst portal: review flagged transactions and appeals |
| `appeal` | Atomic | 8003 | Customer appeal lifecycle |
| `notification` | Atomic | — | Email/SMS notifications on key events |
| `audit` | Atomic | — | Structured JSON audit log of all events |
| `analytics` | Atomic | — | In-memory dashboard metrics |
| `gateway` | Composite | 8004 | Customer-facing API aggregation and enrichment |

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
| Nginx | 8088 | Static UI files + reverse proxy |
| Kong | 80 (proxy), 8090 (admin) | API gateway, JWT auth, rate limiting |
| Redpanda (Kafka) | 19092 (external), 9092 (internal) | Event streaming |
| Grafana | 3000 | Monitoring dashboards |
| Prometheus | 9090 | Metrics scraping |

---

## Kafka Topics

| Topic | Produced by | Consumed by |
|---|---|---|
| `transaction.created` | transaction | detect_fraud, audit |
| `transaction.scored` | detect_fraud | decision / OutSystems |
| `transaction.flagged` | decision / OutSystems | transaction, process_flagged_appeals, notification, audit, analytics |
| `transaction.finalised` | decision / OutSystems | transaction, notification, audit, analytics |
| `transaction.reviewed` | process_flagged_appeals | transaction, notification, audit, analytics |
| `appeal.created` | appeal | process_flagged_appeals, audit, analytics |
| `appeal.resolved` | process_flagged_appeals | appeal, notification, audit, analytics |

---

## Decision Thresholds (configurable in `.env`)

| Score | Decision |
|---|---|
| 0 – `APPROVE_MAX_SCORE` (default 40) | Auto APPROVED |
| 41 – `FLAG_MAX_SCORE` (default 70) | FLAGGED for manual review |
| 71 – 100 | Auto REJECTED |

---

## Credentials (managed in `.env`)

| Portal | Default Username | Default Password |
|---|---|---|
| Fraud Review | `analyst` | `analyst123` |
| Manager Dashboard | `manager` | `manager123` |
| Grafana | `admin` | `admin123` |

---

## Quick Start

```bash
cp .env.example .env   # fill in secrets
docker compose up -d --build
```

Access the banking portal at `http://localhost:8088`.
