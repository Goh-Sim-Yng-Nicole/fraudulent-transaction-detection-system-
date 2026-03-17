# Fraudulent Transaction Detection System (FTDS)

Service-oriented (microservices) system that detects and mitigates fraudulent financial transactions using rule-based + machine learning techniques, real-time event processing, and human review / appeal workflows. Developed as an academic project.

## What’s in this repo

This repository contains a runnable local reference implementation (MVP) of three scenarios:

1. Customer submits a transaction → auto approve/reject
2. Customer submits a high-risk transaction → flagged → fraud team review → resolved
3. Customer submits an appeal → fraud team resolves appeal → transaction outcome updated

## Quickstart (Docker)

Prereqs: Docker Desktop.

1. Copy environment defaults: `cp .env.example .env`
2. Start everything: `docker compose up --build`

### PostgreSQL

Each microservice has its own Postgres instance (defaults in `.env.example`):

- Transaction DB: `localhost:5432` (db `ftds_transaction`)
- Appeal DB: `localhost:5433` (db `ftds_appeal`)
- Fraud Review DB: `localhost:5434` (db `ftds_fraud_review`)

User/password default to `postgres` / `postgres`.

Tables are created by dedicated `*-migrate` jobs in `docker-compose.yml` (MVP). Connection is controlled via per-service `DATABASE_URL` (in Docker Compose this is injected automatically).

Services (localhost):
- Customer Banking API (Transaction): `http://localhost:8000`
- Fraud Score API: `http://localhost:8001`
- Fraud Review Team API (Flagged & Appeals): `http://localhost:8002`
- Appeal API: `http://localhost:8003`
- Gateway / Composite Service (BFF): `http://localhost:8004`

## Key Kafka topics

- `transaction.created`
- `transaction.scored`
- `transaction.flagged`
- `transaction.finalised`
- `transaction.reviewed`
- `appeal.created`
- `appeal.resolved`

## Example usage

Create a transaction (direct to Transaction API):

```powershell
$txn = Invoke-RestMethod -Method Post -Uri http://localhost:8000/transactions `
  -ContentType application/json `
  -Body (@{
    amount      = 120.50
    currency    = "USD"
    card_type   = "VISA"
    country     = "US"
    merchant_id = "m_123"
    hour_utc    = 13
  } | ConvertTo-Json)

$txn
```

Fetch transaction state:

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:8000/transactions/$($txn.transaction_id)"
```

Fetch the transaction decision via the composite gateway (BFF):

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:8004/customer/transactions/$($txn.transaction_id)/decision"
```

### Scenario 2: Flagged transaction → fraud review

List flagged cases (Fraud Review Team API):

```powershell
Invoke-RestMethod -Method Get -Uri http://localhost:8002/flagged
```

Resolve a flagged case:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8002/flagged/$($txn.transaction_id)/resolve" `
  -ContentType application/json `
  -Body (@{ manual_outcome="APPROVED"; reason="Verified by analyst" } | ConvertTo-Json)
```

### Scenario 3: Appeal → appeal resolution

Create an appeal (Appeal API):

```powershell
$appeal = Invoke-RestMethod -Method Post -Uri http://localhost:8003/appeals `
  -ContentType application/json `
  -Body (@{ transaction_id=$txn.transaction_id; reason_for_appeal="This was me" } | ConvertTo-Json)
```

List appeals for the fraud team:

```powershell
Invoke-RestMethod -Method Get -Uri http://localhost:8002/appeals
```

Resolve an appeal (Fraud Review Team API):

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8002/appeals/$($appeal.appeal_id)/resolve" `
  -ContentType application/json `
  -Body (@{ manual_outcome="REJECTED"; outcome_reason="Insufficient evidence" } | ConvertTo-Json)
```

## Notes

- This is an MVP for learning/demo: Transaction, Appeal, and Fraud Review persist to Postgres; other services log to stdout.
- Event contracts live in `ftds/schemas.py`.
- Kafka is exposed on `localhost:19092` (external listener) in `docker-compose.yml`.

