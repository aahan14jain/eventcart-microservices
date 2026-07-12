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
