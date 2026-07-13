import { DlqMessage, DlqRelayEvent, SagaInstance, SagaStatusRelayEvent, SagaStep, SagaStepName, SagaStepOutcome } from './models';

const TOPIC_STATUS: Record<string, { status: string; step: SagaStepName; outcome: SagaStepOutcome }> = {
  'order.created': { status: 'PENDING', step: 'ORDER', outcome: 'SUCCESS' },
  'inventory.reserved': { status: 'RESERVED', step: 'INVENTORY', outcome: 'SUCCESS' },
  'inventory.failed': { status: 'FAILED', step: 'INVENTORY', outcome: 'FAILURE' },
  'inventory.released': { status: 'FAILED', step: 'INVENTORY', outcome: 'SUCCESS' },
  'payment.succeeded': { status: 'CONFIRMED', step: 'PAYMENT', outcome: 'SUCCESS' },
  'payment.failed': { status: 'FAILED', step: 'PAYMENT', outcome: 'FAILURE' },
};

/** Apply a relay saga.status event onto the in-memory saga list (newest first). */
export function applySagaRelayEvent(sagas: SagaInstance[], event: SagaStatusRelayEvent): SagaInstance[] {
  if (!event.orderId) {
    return sagas;
  }
  const mapping = TOPIC_STATUS[event.topic];
  if (!mapping) {
    return sagas;
  }

  const now = new Date(event.timestamp || Date.now()).toISOString();
  const step: SagaStep = {
    step: mapping.step,
    eventType: event.topic,
    outcome: mapping.outcome,
    recordedAt: now,
  };

  const idx = sagas.findIndex((s) => s.orderId === event.orderId);
  if (idx === -1) {
    const created: SagaInstance = {
      orderId: event.orderId,
      currentStatus: mapping.status,
      steps: [step],
      createdAt: now,
      updatedAt: now,
    };
    return [created, ...sagas];
  }

  const existing = sagas[idx];
  const already = existing.steps.some((s) => s.eventType === event.topic && s.recordedAt === now);
  if (already) {
    return sagas;
  }
  // Avoid duplicate steps for the same event type if we already have one (relay can race with poll).
  const hasSameEvent = existing.steps.some((s) => s.eventType === event.topic);
  const steps = hasSameEvent ? existing.steps : [...existing.steps, step];

  const updated: SagaInstance = {
    ...existing,
    currentStatus: mapping.status,
    steps,
    updatedAt: now,
  };

  const next = [...sagas];
  next.splice(idx, 1);
  return [updated, ...next];
}

function payloadToString(payload: unknown): string {
  if (payload == null) {
    return '';
  }
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

export function dlqLiveId(topic: string, partition: number, offset: string | number): string {
  return `live:${topic}:${partition}:${offset}`;
}

/** Prepend a relay DLQ event if not already present (by topic/partition/offset). */
export function applyDlqRelayEvent(messages: DlqMessage[], event: DlqRelayEvent): DlqMessage[] {
  const offsetNum = Number(event.offset);
  const exists = messages.some(
    (m) => m.topic === event.topic && m.partition === event.partition && Number(m.offset) === offsetNum,
  );
  if (exists) {
    return messages;
  }

  const row: DlqMessage = {
    id: dlqLiveId(event.topic, event.partition, event.offset),
    topic: event.topic,
    partition: event.partition,
    offset: offsetNum,
    originalTopic: event.originalTopic,
    payload: payloadToString(event.payload),
    receivedAt: new Date(event.timestamp || Date.now()).toISOString(),
    replayed: false,
  };
  return [row, ...messages];
}

/** Prefer server rows; keep any live-only rows not yet reflected by the API. */
export function mergeDlqFromServer(server: DlqMessage[], local: DlqMessage[]): DlqMessage[] {
  const serverKeys = new Set(server.map((m) => `${m.topic}:${m.partition}:${m.offset}`));
  const pendingLive = local.filter(
    (m) => m.id.startsWith('live:') && !serverKeys.has(`${m.topic}:${m.partition}:${m.offset}`),
  );
  return [...pendingLive, ...server];
}
