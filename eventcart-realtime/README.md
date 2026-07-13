# EventCart realtime relay

Minimal **Kafka → WebSocket** fan-out for saga step events and DLQ messages. No database — a relay only.

## Run

```bash
# Kafka must be reachable (docker compose up -d kafka)
cd eventcart-realtime
npm install
npm start
```

- Health: `http://localhost:8090/health`
- WebSocket: `ws://localhost:8090/ws`

Env overrides: `PORT`, `KAFKA_BROKERS` (default `localhost:29092`), `KAFKA_GROUP_ID`.

## Message shapes

**Saga status**

```json
{ "type": "saga.status", "topic": "inventory.reserved", "orderId": "...", "payload": { ... } }
```

**DLQ**

```json
{ "type": "dlq.message", "topic": "payment.failed.DLT", "originalTopic": "payment.failed", "orderId": "...", "payload": { ... } }
```

## Quick client check

```bash
npx --yes wscat -c ws://localhost:8090/ws
```
