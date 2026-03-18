# Audit Service

Produces structured JSON audit log entries for every event in the system. Logs are written to stdout and can be captured by a log aggregator.

**Type:** Atomic microservice (Kafka worker only) | **Port:** None

---

## Kafka Events Consumed (all 7)

| Topic | Log summary |
|---|---|
| `transaction.created` | Transaction submitted |
| `transaction.scored` | Fraud score assigned |
| `transaction.flagged` | Transaction flagged for review |
| `transaction.finalised` | Transaction auto-decided (APPROVED/REJECTED) |
| `transaction.reviewed` | Analyst manual decision |
| `appeal.created` | Customer submitted appeal |
| `appeal.resolved` | Appeal resolved by analyst |

---

## Log Format

Each entry is printed as `[audit] <JSON>`:

```json
{
  "audit_at": "2026-03-18T10:00:00Z",
  "event_type": "transaction.finalised.v1",
  "summary": "Transaction abc123 finalised: APPROVED",
  "transaction_id": "abc123",
  "outcome": "APPROVED",
  "rules_score": 32
}
```
