# FTDS - Fraudulent Transaction Detection System

A microservices-based banking platform with real-time fraud detection, Kafka event streaming, and separate user interfaces for customers, fraud analysts, and banking managers.

---

## Architecture Overview

```text
Customer UI (banking.html)
  -> Nginx :8088 -> Kong :80 -> Gateway :8004
                               -> Customer :8005

Fraud Review UI (fraud-review.html) -> Process Flagged & Appeals :8002
Manager Dashboard (manager.html)    -> Analytics HTTP endpoint
Grafana :3000                       <- Prometheus :9090 <- cAdvisor
```

### Event Flow

```text
[Customer] -> POST /transaction
  -> transaction.created
    -> detect_fraud
        -> fraud_score :8001
        -> publish transaction.scored
        -> hand off scored payload to OutSystems (optional)
        -> if OutSystems is not configured, local fallback emits:
            -> transaction.finalised -> transaction, notification, audit, analytics
            -> transaction.flagged   -> transaction, process_flagged_appeals, notification, audit, analytics
                -> analyst resolves  -> transaction.reviewed -> transaction, notification, audit, analytics
                -> customer appeals  -> appeal.created -> process_flagged_appeals, audit, analytics
                    -> analyst resolves appeal -> appeal.resolved -> appeal, notification, audit, analytics
```

---

## Services

| Service | Type | Port | Description |
|---|---|---|---|
| `customer` | Atomic | 8005 | Registration, login, OTP, profile management |
| `transaction` | Atomic | 8000 | Transaction lifecycle and Kafka-driven status updates |
| `fraud_score` | Atomic | 8001 | ML fraud scoring via Random Forest |
| `detect_fraud` | Composite | 8008 | Orchestrates fraud scoring, publishes `transaction.scored`, and integrates with OutSystems plus a local fallback |
| `process_flagged_appeals` | Composite | 8002 | Analyst portal for flagged transactions and appeals |
| `appeal` | Atomic | 8003 | Customer appeal lifecycle |
| `notification` | Atomic | 8010 | Email and SMS notifications on key events |
| `audit` | Atomic | 8007 | Structured audit log of platform events |
| `analytics` | Atomic | 8006 | In-memory dashboard metrics and manager endpoints |
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
| Nginx | 8088 | Static UI files and reverse proxy |
| Kong | 80 (proxy), 8090 (admin) | API gateway, JWT auth, rate limiting |
| Redpanda (Kafka) | 19092 (external), 9092 (internal) | Event streaming |
| Grafana | 3000 | Monitoring dashboards |
| Prometheus | 9090 | Metrics scraping |

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
docker compose up -d --build
```

Access the banking portal at `http://localhost:8088`.
