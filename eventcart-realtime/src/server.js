/**
 * EventCart realtime relay: one Kafka consumer → WebSocket broadcast.
 * No persistence — clients should still use the admin HTTP API as source of truth.
 *
 * Env:
 *   PORT                 HTTP/WS port (default 8090)
 *   KAFKA_BROKERS        comma-separated brokers (default localhost:29092)
 *   KAFKA_GROUP_ID       consumer group (default eventcart-realtime)
 */
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Kafka, logLevel } = require('kafkajs');

const PORT = Number(process.env.PORT || 8090);
const BROKERS = (process.env.KAFKA_BROKERS || 'localhost:29092')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const GROUP_ID = process.env.KAFKA_GROUP_ID || 'eventcart-realtime';

/** Saga choreography topics + order-service DLT topics. */
const TOPICS = [
  'order.created',
  'inventory.reserved',
  'inventory.failed',
  'inventory.released',
  'payment.succeeded',
  'payment.failed',
  'inventory.reserved.DLT',
  'inventory.failed.DLT',
  'payment.succeeded.DLT',
  'payment.failed.DLT',
];

function isDlqTopic(topic) {
  return topic.endsWith('.DLT');
}

function parsePayload(value) {
  if (value == null) return null;
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function buildEvent(topic, message) {
  const payload = parsePayload(message.value);
  const orderId =
    (payload && (payload.orderId || payload.order_id)) ||
    (message.key ? message.key.toString('utf8') : null);

  if (isDlqTopic(topic)) {
    return {
      type: 'dlq.message',
      topic,
      originalTopic: topic.replace(/\.DLT$/, ''),
      orderId,
      partition: message.partition,
      offset: message.offset,
      payload,
      timestamp: message.timestamp ? Number(message.timestamp) : Date.now(),
    };
  }

  return {
    type: 'saga.status',
    topic,
    orderId,
    partition: message.partition,
    offset: message.offset,
    payload,
    timestamp: message.timestamp ? Number(message.timestamp) : Date.now(),
  };
}

function broadcast(wss, event) {
  const data = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

async function main() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      brokers: BROKERS,
      topics: TOPICS.length,
      clients: wss.clients.size,
    });
  });

  wss.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        type: 'relay.hello',
        message: 'EventCart realtime relay connected',
        topics: TOPICS,
      }),
    );
  });

  const kafka = new Kafka({
    clientId: 'eventcart-realtime',
    brokers: BROKERS,
    logLevel: logLevel.WARN,
  });

  const consumer = kafka.consumer({ groupId: GROUP_ID });
  await consumer.connect();
  await consumer.subscribe({ topics: TOPICS, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const event = buildEvent(topic, message);
      broadcast(wss, event);
    },
  });

  server.listen(PORT, () => {
    console.log(`eventcart-realtime listening on http://localhost:${PORT}`);
    console.log(`WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`Kafka brokers: ${BROKERS.join(', ')}`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} — shutting down`);
    try {
      await consumer.disconnect();
    } catch (_) {
      /* ignore */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start eventcart-realtime', err);
  process.exit(1);
});
