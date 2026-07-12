# EventCart k6 load tests

## Checkout flow

Script: [`checkout.js`](./checkout.js)

Each VU iteration:

1. `POST /orders` with randomized items / totals (small % `FAIL` SKU and `forcePaymentFailure`)
2. Poll `GET /orders/{id}` until `CONFIRMED` or `FAILED` (or timeout)

### Quick run (k6 only)

```bash
k6 run load-tests/k6/checkout.js
# → load-tests/k6/checkout-summary.json
# → load-tests/k6/checkout-one-pager.md   (success / errors / p95 / duplicates)
```

### Full run with observability capture (recommended for resume)

Captures **Kafka consumer lag**, **Redis idempotency hit/miss**, and **Postgres Hikari pool** from Prometheus while k6 runs, then writes a paste-ready report:

```bash
docker compose up -d kafka kafka-exporter prometheus grafana
# start services (order with --spring.profiles.active=postgres for Hikari metrics)

./load-tests/k6/run-with-observability.sh
# or: PEAK_VUS=200 BASE_URL=http://localhost:8080 ./load-tests/k6/run-with-observability.sh
```

Outputs:

| File | Contents |
|------|----------|
| `LOAD_TEST_REPORT.md` | Resume blurb + tables (success, errors, p95, duplicates, lag, Redis, Hikari) |
| `checkout-one-pager.md` | Short k6-only summary |
| `checkout-summary.json` | Full k6 JSON |
| `prom-samples.jsonl` | Prometheus samples during the run |

Grafana dashboard: **EventCart Load Test** at http://localhost:3000 (admin/admin)

### Metrics reference

| Signal | Prometheus |
|--------|------------|
| Kafka lag | `kafka_consumergroup_lag` (kafka_exporter `:9308`) |
| Idempotency miss/hit | `idempotency_claims_total{result="miss\|hit"}` |
| Postgres pool | `hikaricp_connections_active\|idle\|pending\|max` (order-service + `postgres` profile) |
