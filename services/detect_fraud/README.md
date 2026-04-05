# Detect Fraud Service

Composite service that consumes `transaction.created`, runs fraud rules and ML scoring, and coordinates the final decision — either via an external OutSystems endpoint or through local fallback logic for Docker development and automated testing.

**Port:** `8008` | **Runtime:** Python / FastAPI | **Type:** Composite service (Kafka worker + HTTP client)

---

## Flow

```text
transaction.created
  -> fraud rules engine (velocity, geography, amount, card)
  -> POST /score to fraud_score (ML scoring)
  -> publish transaction.scored
  -> if OutSystems decision URL is set:
      -> POST scored payload to OutSystems
      -> OutSystems publishes decision via Kafka (outsystems_kafka mode)
         or returns decision via HTTP (outsystems_http mode)
  -> if OutSystems is unset or unavailable and local fallback is enabled:
      -> publish transaction.flagged / transaction.finalised locally
```

---

## Decision Modes

| Mode               | Behaviour                                                               |
| ------------------ | ----------------------------------------------------------------------- |
| `local`            | All decisioning handled locally; publishes flagged/finalised directly   |
| `outsystems_http`  | Sends scored transaction to OutSystems via HTTP; receives decision back  |
| `outsystems_kafka` | Sends to OutSystems via HTTP; OutSystems publishes decision to Kafka     |

Set via the `DECISION_INTEGRATION_MODE` environment variable.

---

## Kafka

| Direction | Topic                                              | Notes                        |
| --------- | -------------------------------------------------- | ---------------------------- |
| Consumes  | `transaction.created`                              |                              |
| Produces  | `transaction.scored`                               | Always published             |
| Produces  | `transaction.flagged` / `transaction.finalised`    | Local fallback mode only     |

---

## Fraud Rules

The rules engine evaluates:

- **Velocity** — hourly and daily transaction counts per customer
- **Geography** — high-risk country list
- **Amount** — high-amount and suspicious-amount thresholds
- **Card** — BIN blacklist and prepaid card flags
- **Time** — unusual transaction hours (outside 06:00–22:00 UTC)
- **Merchant** — internal transfer merchant patterns

---

## Environment Variables

| Variable                         | Description                                                              |
| -------------------------------- | ------------------------------------------------------------------------ |
| `FRAUD_SCORE_URL`                | URL of the fraud score endpoint (default `http://fraud-score:8001/score`) |
| `KAFKA_BOOTSTRAP_SERVERS`        | Kafka broker address                                                     |
| `DECISION_INTEGRATION_MODE`      | `local` / `outsystems_http` / `outsystems_kafka`                         |
| `OUTSYSTEMS_DECISION_URL`        | Optional HTTP endpoint for external decisioning                          |
| `OUTSYSTEMS_AUTH_TYPE`           | `bearer` or `none`                                                       |
| `OUTSYSTEMS_BEARER_TOKEN`        | Bearer token when `OUTSYSTEMS_AUTH_TYPE=bearer`                          |
| `ENABLE_LOCAL_DECISION_FALLBACK` | `true` to emit decisions locally if OutSystems is unavailable            |
| `HIGH_RISK_COUNTRIES`            | Comma-separated ISO country codes                                        |
| `HIGH_AMOUNT_THRESHOLD`          | Amount above which a transaction is flagged as high-value                |
| `AUTO_APPROVE_WHITELIST`         | Comma-separated customer IDs that bypass fraud checks                    |
| `AUTO_DECLINE_BLACKLIST`         | Comma-separated customer IDs that are always declined                    |
