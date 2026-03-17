# Decision Service

**Type:** Atomic Microservice
**Port:** None (Kafka worker only)
**Tech:** Python, aiokafka

---

## Responsibility

Reads fraud scores from the `transaction.scored` topic and decides the outcome for each transaction based on configurable thresholds:

| Score range | Action | Topic published |
|---|---|---|
| `score ≤ APPROVE_MAX_SCORE` (default 40) | Auto-approve | `transaction.finalised` (outcome: `APPROVED`) |
| `APPROVE_MAX_SCORE < score ≤ FLAG_MAX_SCORE` (default 41–70) | Flag for manual review | `transaction.flagged` |
| `score > FLAG_MAX_SCORE` (default > 70) | Auto-reject | `transaction.finalised` (outcome: `REJECTED`) |

---

## Kafka

| Direction | Topic | Event type |
|---|---|---|
| Consumes | `transaction.scored` | `transaction.scored.v1` |
| Publishes | `transaction.finalised` | `transaction.finalised.v1` |
| Publishes | `transaction.flagged` | `transaction.flagged.v1` |

---

## Environment Variables

| Variable | Description |
|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | Kafka broker address |
| `APPROVE_MAX_SCORE` | Upper bound for auto-approval (default: 40) |
| `FLAG_MAX_SCORE` | Upper bound for flagging; above this = rejected (default: 70) |
