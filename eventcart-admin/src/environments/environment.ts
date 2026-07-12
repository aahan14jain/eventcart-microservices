export const environment = {
  production: false,
  /** Empty = use Angular proxy (/admin → order-service). Override for direct API calls. */
  apiBaseUrl: '',
  adminApiKey: 'eventcart-admin-key-change-me',
  sagasPollIntervalMs: 5000,
};
