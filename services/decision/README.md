# Decision Service

Applies threshold logic to a fraud score and emits either `transaction.finalised` (APPROVED/REJECTED) or `transaction.flagged`.

**Type:** Atomic microservice (Kafka worker only) | **Status:** Being replaced by OutSystems

---

## Status

The Python worker code is present but will be **commented out** of `docker-compose.yml` once the OutSystems module (`FTDS_Decision`) is live. OutSystems replicates the same logic with an auditable `DecisionQueue` entity in its database.

---

## Kafka

| Direction | Topic                                            |
| --------- | ------------------------------------------------ |
| Consumes  | `transaction.scored`                           |
| Produces  | `transaction.finalised` (APPROVED or REJECTED) |
| Produces  | `transaction.flagged`                          |

---

## Threshold Logic

```
score ≤ APPROVE_MAX_SCORE  →  transaction.finalised { outcome: "APPROVED" }
score ≤ FLAG_MAX_SCORE     →  transaction.flagged
score >  FLAG_MAX_SCORE    →  transaction.finalised { outcome: "REJECTED" }
```

Thresholds are set via environment variables:

| Variable              | Default |
| --------------------- | ------- |
| `APPROVE_MAX_SCORE` | `40`  |
| `FLAG_MAX_SCORE`    | `70`  |

---

## OutSystems Replacement

The OutSystems module `FTDS_Decision` implements (with DB):

```
Kafka: transaction.scored
  ↓  Timer: ConsumeScored (every 5s)
DecisionQueue entity { status = PENDING }
  ↓  Timer: ProcessDecisions (every 10s)
Apply Site Property thresholds
  ↓
Kafka: transaction.finalised OR transaction.flagged
  ↓
DecisionQueue.status = PROCESSED (full audit trail)
```
