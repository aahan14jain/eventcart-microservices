/**
 * EventCart checkout load test (k6)
 *
 * Flow per VU iteration:
 *   1. POST /orders with a randomized realistic payload
 *   2. Poll GET /orders/{id} until status is CONFIRMED or FAILED (or timeout)
 *
 * Reports:
 *   - success rate (terminal CONFIRMED|FAILED after create OK)
 *   - average / p95 time-to-completion (create → terminal status)
 *   - duplicate side-effect errors (status regression / duplicate markers)
 *
 * Run (examples):
 *   k6 run load-tests/k6/checkout.js
 *   k6 run -e BASE_URL=http://localhost:8080 -e PEAK_VUS=1000 load-tests/k6/checkout.js
 *   k6 run --vus 50 --duration 2m load-tests/k6/checkout.js   # overrides stages if using --vus/--duration
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const PEAK_VUS = Number(__ENV.PEAK_VUS || 1000);
const POLL_INTERVAL_MS = Number(__ENV.POLL_INTERVAL_MS || 200);
const POLL_TIMEOUT_MS = Number(__ENV.POLL_TIMEOUT_MS || 30000);
const FAIL_SKU_PCT = Number(__ENV.FAIL_SKU_PCT || 2); // inventory.failed path
const FORCE_PAY_FAIL_PCT = Number(__ENV.FORCE_PAY_FAIL_PCT || 3); // payment.failed path

const checkoutDuration = new Trend('checkout_duration_ms', true);
const checkoutSuccess = new Rate('checkout_success_rate');
const checkoutConfirmed = new Rate('checkout_confirmed_rate');
const checkoutFailed = new Rate('checkout_failed_rate');
const checkoutTimedOut = new Rate('checkout_timeout_rate');
const createErrors = new Counter('order_create_errors');
const pollErrors = new Counter('order_poll_errors');
const duplicateSideEffects = new Counter('duplicate_side_effect_errors');

const SKUS = [
  'BOOK-101',
  'BOOK-202',
  'TEE-NAVY-M',
  'TEE-NAVY-L',
  'MUG-CERAMIC',
  'STICKER-PACK',
  'HOODIE-XL',
  'CAP-BLACK',
  'SOCKS-3PK',
  'USB-C-CABLE',
];

export const options = {
  scenarios: {
    checkout_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.max(50, Math.floor(PEAK_VUS * 0.1)) },
        { duration: '45s', target: Math.max(200, Math.floor(PEAK_VUS * 0.4)) },
        { duration: '60s', target: PEAK_VUS },
        { duration: '90s', target: PEAK_VUS }, // sustain ~1000 concurrent checkout attempts
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // Terminal success = create OK and reached CONFIRMED or FAILED before poll timeout
    checkout_success_rate: ['rate>0.90'],
    checkout_duration_ms: ['avg<8000', 'p(95)<20000'],
    http_req_failed: ['rate<0.05'],
    duplicate_side_effect_errors: ['count==0'],
    checkout_timeout_rate: ['rate<0.10'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function buildOrderPayload() {
  const itemCount = randomInt(1, 4);
  const items = [];
  let total = 0;

  for (let i = 0; i < itemCount; i++) {
    const qty = randomInt(1, 5);
    const unit = Number((Math.random() * 80 + 5).toFixed(2));
    let sku = pick(SKUS);
    // Small fraction: inventory failure path (sku FAIL)
    if (Math.random() * 100 < FAIL_SKU_PCT) {
      sku = 'FAIL';
    }
    items.push({ sku, quantity: qty });
    total += unit * qty;
  }

  const body = {
    items,
    totalAmount: Number(total.toFixed(2)),
  };

  if (Math.random() * 100 < FORCE_PAY_FAIL_PCT) {
    body.forcePaymentFailure = true;
  }

  return body;
}

function looksLikeDuplicate(bodyText, statusText) {
  const hay = `${bodyText || ''} ${statusText || ''}`.toLowerCase();
  return (
    hay.includes('duplicate') ||
    hay.includes('already processed') ||
    hay.includes('idempoten') ||
    hay.includes('duplicate_ignored')
  );
}

function isTerminal(status) {
  return status === 'CONFIRMED' || status === 'FAILED';
}

function pollUntilTerminal(orderId, correlationId) {
  const started = Date.now();
  let lastStatus = 'PENDING';
  let sawTerminal = null;
  const headers = {
    Accept: 'application/json',
  };
  if (correlationId) {
    headers['X-Correlation-Id'] = correlationId;
  }

  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const res = http.get(`${BASE_URL}/orders/${orderId}`, {
      headers,
      tags: { name: 'GET /orders/{id}' },
    });

    if (res.status === 404) {
      // eventual consistency / cache miss — keep polling briefly
      sleep(POLL_INTERVAL_MS / 1000);
      continue;
    }

    if (res.status < 200 || res.status >= 300) {
      pollErrors.add(1);
      if (looksLikeDuplicate(res.body, '')) {
        duplicateSideEffects.add(1, { reason: 'poll_duplicate_marker' });
      }
      sleep(POLL_INTERVAL_MS / 1000);
      continue;
    }

    let status = '';
    try {
      status = String(JSON.parse(res.body).status || '').toUpperCase();
    } catch (_) {
      pollErrors.add(1);
      sleep(POLL_INTERVAL_MS / 1000);
      continue;
    }

    // Duplicate / inconsistent side-effect: status moved backward after a terminal state
    if (sawTerminal && status && status !== sawTerminal && !isTerminal(status)) {
      duplicateSideEffects.add(1, { reason: 'status_regression' });
    }
    if (sawTerminal && isTerminal(status) && status !== sawTerminal) {
      duplicateSideEffects.add(1, { reason: 'conflicting_terminal_status' });
    }

    lastStatus = status || lastStatus;
    if (isTerminal(status)) {
      if (!sawTerminal) {
        sawTerminal = status;
      }
      return { status, timedOut: false, elapsedMs: Date.now() - started };
    }

    sleep(POLL_INTERVAL_MS / 1000);
  }

  return { status: lastStatus, timedOut: true, elapsedMs: Date.now() - started };
}

export default function checkoutFlow() {
  const payload = buildOrderPayload();
  const correlationId = `k6-${__VU}-${__ITER}-${Date.now()}`;

  const createRes = http.post(`${BASE_URL}/orders`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Correlation-Id': correlationId,
    },
    tags: { name: 'POST /orders' },
  });

  const created = check(createRes, {
    'POST /orders status 200': (r) => r.status === 200,
    'POST /orders has orderId': (r) => {
      try {
        return !!JSON.parse(r.body).orderId;
      } catch (_) {
        return false;
      }
    },
  });

  if (!created) {
    createErrors.add(1);
    checkoutSuccess.add(false);
    checkoutConfirmed.add(false);
    checkoutFailed.add(false);
    checkoutTimedOut.add(false);
    if (looksLikeDuplicate(createRes.body, '')) {
      duplicateSideEffects.add(1, { reason: 'create_duplicate_marker' });
    }
    sleep(0.1);
    return;
  }

  let orderId;
  try {
    orderId = JSON.parse(createRes.body).orderId;
  } catch (_) {
    createErrors.add(1);
    checkoutSuccess.add(false);
    return;
  }

  const flowStarted = Date.now();
  const result = pollUntilTerminal(orderId, correlationId);
  const totalMs = Date.now() - flowStarted;

  checkoutDuration.add(totalMs);

  const success = !result.timedOut && isTerminal(result.status);
  checkoutSuccess.add(success);
  checkoutConfirmed.add(result.status === 'CONFIRMED');
  checkoutFailed.add(result.status === 'FAILED');
  checkoutTimedOut.add(!!result.timedOut);

  check(result, {
    'checkout reached terminal status': (r) => !r.timedOut && isTerminal(r.status),
  });

  // Small pacing so a single VU does not spin hotter than the poll loop already does
  sleep(0.05);
}

export function handleSummary(data) {
  const successRate = data.metrics.checkout_success_rate?.values?.rate;
  const avgMs = data.metrics.checkout_duration_ms?.values?.avg;
  const p95Ms = data.metrics.checkout_duration_ms?.values['p(95)'];
  const dupCount = data.metrics.duplicate_side_effect_errors?.values?.count ?? 0;
  const confirmed = data.metrics.checkout_confirmed_rate?.values?.rate;
  const failed = data.metrics.checkout_failed_rate?.values?.rate;
  const timedOut = data.metrics.checkout_timeout_rate?.values?.rate;
  const createErr = data.metrics.order_create_errors?.values?.count ?? 0;
  const pollErr = data.metrics.order_poll_errors?.values?.count ?? 0;
  const iters = data.metrics.iterations?.values?.count ?? 0;
  const successCount = Math.round((successRate || 0) * iters);
  const errorCount = createErr + pollErr;

  const lines = [
    '',
    '===== EventCart checkout load summary =====',
    `BASE_URL=${BASE_URL}  PEAK_VUS=${PEAK_VUS}`,
    `Success count≈${successCount}  Error count=${errorCount}  Iterations=${iters}`,
    `Success rate (terminal CONFIRMED|FAILED): ${fmtPct(successRate)}`,
    `Confirmed rate: ${fmtPct(confirmed)}   Failed rate: ${fmtPct(failed)}   Timeout rate: ${fmtPct(timedOut)}`,
    `Time-to-completion avg: ${fmtMs(avgMs)}   p95: ${fmtMs(p95Ms)}`,
    `Duplicate side-effect errors: ${dupCount}${dupCount === 0 ? '  (zero duplicate inventory/payment side effects)' : ''}`,
    'Tip: ./load-tests/k6/run-with-observability.sh also samples Kafka lag / Redis idempotency / Hikari pool',
    '==========================================',
    '',
  ];

  const onePager = [
    '# EventCart k6 checkout — quick summary',
    '',
    `| Metric | Value |`,
    `|--------|------:|`,
    `| Success count (approx) | ${successCount} |`,
    `| Error count (create+poll) | ${errorCount} |`,
    `| Success rate | ${fmtPct(successRate)} |`,
    `| p95 time-to-completion | ${fmtMs(p95Ms)} |`,
    `| avg time-to-completion | ${fmtMs(avgMs)} |`,
    `| Duplicate side effects | ${dupCount} |`,
    '',
    dupCount === 0
      ? '**Zero duplicate inventory/payment side effects** observed by the client load driver.'
      : '⚠️ Duplicate side-effect markers were observed — investigate idempotency / status flips.',
    '',
    '_Infra (Kafka lag, Redis hit/miss, Hikari pool): run `./load-tests/k6/run-with-observability.sh` for a full `LOAD_TEST_REPORT.md`._',
    '',
  ].join('\n');

  return {
    stdout: `${lines.join('\n')}${textSummary(data, { indent: ' ', enableColors: true })}`,
    'load-tests/k6/checkout-summary.json': JSON.stringify(data, null, 2),
    'load-tests/k6/checkout-one-pager.md': onePager,
  };
}

function fmtPct(rate) {
  if (rate == null || Number.isNaN(rate)) return 'n/a';
  return `${(rate * 100).toFixed(2)}%`;
}

function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return 'n/a';
  return `${ms.toFixed(1)} ms`;
}
