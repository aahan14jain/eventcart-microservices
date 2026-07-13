export type SagaStepName = 'ORDER' | 'INVENTORY' | 'PAYMENT';
export type SagaStepOutcome = 'SUCCESS' | 'FAILURE';

export interface SagaStep {
  step: SagaStepName;
  eventType: string;
  outcome: SagaStepOutcome;
  recordedAt: string;
}

export interface SagaInstance {
  orderId: string;
  currentStatus: string;
  steps: SagaStep[];
  createdAt: string;
  updatedAt: string;
}

export interface DlqMessage {
  id: string;
  topic: string;
  partition: number;
  offset: number;
  originalTopic: string;
  payload: string;
  receivedAt: string;
  replayed: boolean;
}

/** Payloads from eventcart-realtime WebSocket relay. */
export interface SagaStatusRelayEvent {
  type: 'saga.status';
  topic: string;
  orderId: string | null;
  partition: number;
  offset: string | number;
  payload: unknown;
  timestamp: number;
}

export interface DlqRelayEvent {
  type: 'dlq.message';
  topic: string;
  originalTopic: string;
  orderId: string | null;
  partition: number;
  offset: string | number;
  payload: unknown;
  timestamp: number;
}

export interface RelayHelloEvent {
  type: 'relay.hello';
  message: string;
  topics: string[];
}

export type RelayEvent = SagaStatusRelayEvent | DlqRelayEvent | RelayHelloEvent;
