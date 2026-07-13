export const environment = {
  production: false,
  /** Empty = use Angular proxy (/admin → order-service). Override for direct API calls. */
  apiBaseUrl: '',
  adminApiKey: 'eventcart-admin-key-change-me',
  /** eventcart-realtime WebSocket (or proxy /ws → :8090). */
  wsUrl: 'ws://localhost:8090/ws',
  /** Poll interval when WebSocket is disconnected. */
  sagasPollIntervalMs: 5000,
  dlqPollIntervalMs: 5000,
  /** Slower HTTP reconcile while WebSocket is live (relay is not source of truth). */
  sagasReconcileIntervalMs: 30000,
  dlqReconcileIntervalMs: 30000,
};
