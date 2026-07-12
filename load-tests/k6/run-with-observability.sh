#!/usr/bin/env bash
# Run the k6 checkout load test while sampling Prometheus for:
#   - Kafka consumer lag (kafka_exporter)
#   - Redis idempotency hit/miss (idempotency_claims_total)
#   - Postgres HikariCP pool (hikaricp_connections_*)
#
# Produces a resume-friendly one-pager:
#   load-tests/k6/LOAD_TEST_REPORT.md
#
# Prerequisites:
#   - order/inventory/payment (+ optional postgres profile) running
#   - docker compose: kafka, kafka-exporter, prometheus, grafana
#   - k6 installed
#
# Usage:
#   ./load-tests/k6/run-with-observability.sh
#   PEAK_VUS=200 BASE_URL=http://localhost:8080 ./load-tests/k6/run-with-observability.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PROM_URL="${PROM_URL:-http://localhost:9090}"
BASE_URL="${BASE_URL:-http://localhost:8080}"
PEAK_VUS="${PEAK_VUS:-200}"
SAMPLE_INTERVAL_SEC="${SAMPLE_INTERVAL_SEC:-5}"
OUT_DIR="${OUT_DIR:-load-tests/k6}"
SAMPLES_FILE="${OUT_DIR}/prom-samples.jsonl"
REPORT_FILE="${OUT_DIR}/LOAD_TEST_REPORT.md"
SUMMARY_JSON="${OUT_DIR}/checkout-summary.json"

mkdir -p "$OUT_DIR"
: > "$SAMPLES_FILE"

prom_query() {
  local expr="$1"
  curl -fsS --get "${PROM_URL}/api/v1/query" --data-urlencode "query=${expr}" 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("data",{}).get("result",[]);
print(json.dumps(r))' 2>/dev/null || echo '[]'
}

prom_scalar() {
  local expr="$1"
  curl -fsS --get "${PROM_URL}/api/v1/query" --data-urlencode "query=${expr}" 2>/dev/null \
    | python3 -c 'import json,sys
d=json.load(sys.stdin)
r=d.get("data",{}).get("result",[])
if not r:
  print("n/a"); raise SystemExit
v=r[0]["value"][1]
print(v)' 2>/dev/null || echo 'n/a'
}

sample_once() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  python3 - "$ts" <<'PY' >> "$SAMPLES_FILE"
import json, os, sys, urllib.parse, urllib.request

prom = os.environ.get("PROM_URL", "http://localhost:9090")
ts = sys.argv[1]

def q(expr):
    url = f"{prom}/api/v1/query?{urllib.parse.urlencode({'query': expr})}"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = json.load(resp)
        return data.get("data", {}).get("result", [])
    except Exception as e:
        return [{"error": str(e)}]

def scalar(expr):
    rows = q(expr)
    if not rows or "value" not in rows[0]:
        return None
    try:
        return float(rows[0]["value"][1])
    except Exception:
        return None

row = {
    "ts": ts,
    "kafka_lag_sum": scalar("sum(kafka_consumergroup_lag)"),
    "kafka_lag_by_group": {
        (r.get("metric") or {}).get("consumergroup", "?"): float(r["value"][1])
        for r in q("sum by (consumergroup) (kafka_consumergroup_lag)")
        if "value" in r
    },
    "idempotency_hit_rate_1m": scalar('sum(rate(idempotency_claims_total{result="hit"}[1m]))'),
    "idempotency_miss_rate_1m": scalar('sum(rate(idempotency_claims_total{result="miss"}[1m]))'),
    "hikari_active": scalar('hikaricp_connections_active{application="order-service"}'),
    "hikari_idle": scalar('hikaricp_connections_idle{application="order-service"}'),
    "hikari_pending": scalar('hikaricp_connections_pending{application="order-service"}'),
    "hikari_max": scalar('hikaricp_connections_max{application="order-service"}'),
}
print(json.dumps(row))
PY
}

echo "==> Checking Prometheus at ${PROM_URL}"
if ! curl -fsS "${PROM_URL}/-/ready" >/dev/null 2>&1; then
  echo "Prometheus not ready. Start stack: docker compose up -d kafka kafka-exporter prometheus grafana" >&2
  echo "Continuing anyway — infra sections of the report may be n/a." >&2
fi

echo "==> Background Prometheus sampler → ${SAMPLES_FILE} (every ${SAMPLE_INTERVAL_SEC}s)"
(
  while true; do
    sample_once || true
    sleep "$SAMPLE_INTERVAL_SEC"
  done
) &
SAMPLER_PID=$!
trap 'kill '"$SAMPLER_PID"' 2>/dev/null || true' EXIT

echo "==> Starting k6 checkout (PEAK_VUS=${PEAK_VUS} BASE_URL=${BASE_URL})"
# shellcheck disable=SC2086
k6 run \
  -e "BASE_URL=${BASE_URL}" \
  -e "PEAK_VUS=${PEAK_VUS}" \
  "${OUT_DIR}/checkout.js"

kill "$SAMPLER_PID" 2>/dev/null || true
trap - EXIT
sample_once || true

echo "==> Building resume report → ${REPORT_FILE}"
PROM_URL="$PROM_URL" python3 - "$SUMMARY_JSON" "$SAMPLES_FILE" "$REPORT_FILE" "$PEAK_VUS" "$BASE_URL" <<'PY'
import json, math, os, sys, urllib.parse, urllib.request
from datetime import datetime, timezone

summary_path, samples_path, report_path, peak_vus, base_url = sys.argv[1:6]
prom = os.environ.get("PROM_URL", "http://localhost:9090")

def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def load_samples(path):
    rows = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    except Exception:
        pass
    return rows

def metric(data, name, field):
    m = (data.get("metrics") or {}).get(name) or {}
    v = (m.get("values") or {}).get(field)
    return v

def fmt_pct(rate):
    if rate is None:
        return "n/a"
    return f"{rate * 100:.2f}%"

def fmt_ms(ms):
    if ms is None:
        return "n/a"
    return f"{ms:.1f} ms"

def fmt_num(v, digits=2):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return "n/a"
    if isinstance(v, float):
        return f"{v:.{digits}f}"
    return str(v)

def max_of(rows, key):
    vals = [r.get(key) for r in rows if isinstance(r.get(key), (int, float))]
    return max(vals) if vals else None

def avg_of(rows, key):
    vals = [r.get(key) for r in rows if isinstance(r.get(key), (int, float))]
    return sum(vals) / len(vals) if vals else None

def prom_scalar(expr):
    url = f"{prom}/api/v1/query?{urllib.parse.urlencode({'query': expr})}"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            data = json.load(resp)
        rows = data.get("data", {}).get("result", [])
        if not rows:
            return None
        return float(rows[0]["value"][1])
    except Exception:
        return None

data = load_json(summary_path)
samples = load_samples(samples_path)

success_rate = metric(data, "checkout_success_rate", "rate")
confirmed = metric(data, "checkout_confirmed_rate", "rate")
failed = metric(data, "checkout_failed_rate", "rate")
timed_out = metric(data, "checkout_timeout_rate", "rate")
avg_ms = metric(data, "checkout_duration_ms", "avg")
p95_ms = metric(data, "checkout_duration_ms", "p(95)")
dup = metric(data, "duplicate_side_effect_errors", "count") or 0
create_err = metric(data, "order_create_errors", "count") or 0
poll_err = metric(data, "order_poll_errors", "count") or 0
http_reqs = metric(data, "http_reqs", "count")
checks_rate = metric(data, "checks", "rate")

# Prefer counters from final Prom scrape when available
idem_hit = prom_scalar('sum(increase(idempotency_claims_total{result="hit"}[15m]))')
idem_miss = prom_scalar('sum(increase(idempotency_claims_total{result="miss"}[15m]))')
if idem_hit is None and idem_miss is None:
    # fall back to peak rates during sampling
    idem_hit = max_of(samples, "idempotency_hit_rate_1m")
    idem_miss = max_of(samples, "idempotency_miss_rate_1m")
    idem_note = "peak 1m rate during run (increase unavailable)"
else:
    idem_note = "Prometheus increase() over ~15m window"

lag_peak = max_of(samples, "kafka_lag_sum")
hikari_peak = max_of(samples, "hikari_active")
hikari_pending_peak = max_of(samples, "hikari_pending")
hikari_max = None
for r in reversed(samples):
    if isinstance(r.get("hikari_max"), (int, float)):
        hikari_max = r["hikari_max"]
        break

zero_dup = int(dup) == 0
now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

# Approximate success/error counts from rates × iterations if available
iters = metric(data, "iterations", "count")
success_count = int(round((success_rate or 0) * (iters or 0))) if iters else "n/a"
error_count = int(create_err) + int(poll_err)

lines = [
    "# EventCart load-test report",
    "",
    f"_Generated {now} · paste into resume backstory / interview notes_",
    "",
    "## Setup",
    f"- API: `{base_url}` · peak VUs: **{peak_vus}**",
    "- Stack: Spring Boot saga services + Kafka + Redis + Postgres (Hikari) · Prometheus/Grafana",
    "- Driver: k6 full checkout (`POST /orders` → poll until `CONFIRMED`/`FAILED`)",
    "",
    "## Checkout results (k6)",
    "",
    "| Metric | Value |",
    "|--------|------:|",
    f"| Success count (approx) | {success_count} |",
    f"| Error count (create+poll) | {error_count} |",
    f"| Success rate (terminal status) | {fmt_pct(success_rate)} |",
    f"| Confirmed / Failed / Timeout | {fmt_pct(confirmed)} / {fmt_pct(failed)} / {fmt_pct(timed_out)} |",
    f"| Time-to-completion **avg** | {fmt_ms(avg_ms)} |",
    f"| Time-to-completion **p95** | {fmt_ms(p95_ms)} |",
    f"| Duplicate side-effect errors | **{int(dup)}** {'✅' if zero_dup else '❌'} |",
    f"| HTTP requests | {fmt_num(http_reqs, 0)} |",
    f"| Checks pass rate | {fmt_pct(checks_rate)} |",
    "",
    "## Infra during the run (Prometheus)",
    "",
    "| Signal | Peak / total |",
    "|--------|-------------:|",
    f"| Kafka consumer lag (sum) | {fmt_num(lag_peak, 0)} |",
    f"| Redis idempotency **miss** (first claim) | {fmt_num(idem_miss)} ({idem_note}) |",
    f"| Redis idempotency **hit** (duplicate) | {fmt_num(idem_hit)} ({idem_note}) |",
    f"| Postgres Hikari **active** connections | {fmt_num(hikari_peak, 0)} (max pool {fmt_num(hikari_max, 0)}) |",
    f"| Postgres Hikari **pending** | {fmt_num(hikari_pending_peak, 0)} |",
    "",
    "## Resume blurb (copy/paste)",
    "",
    (
        f"Drove a k6 checkout load test against an event-driven Spring Boot saga "
        f"(peak **{peak_vus}** VUs): **{fmt_pct(success_rate)}** terminal success, "
        f"**p95 time-to-completion {fmt_ms(p95_ms)}**, **{int(dup)} duplicate inventory/payment "
        f"side effects**. Monitored **Kafka consumer lag**, **Redis SETNX idempotency hit/miss**, "
        f"and **Postgres HikariCP pool usage** via Prometheus/Grafana during the run."
    ),
    "",
    "## Screenshot checklist",
    "",
    "1. Grafana → **EventCart Load Test** (`http://localhost:3000`) — lag, idempotency, Hikari panels",
    "2. This file's checkout table (or k6 stdout banner)",
    "3. Optional: Kafka UI consumer groups (`http://localhost:8085`)",
    "",
    "## Artifacts",
    "",
    f"- `{summary_path}` — full k6 JSON summary",
    f"- `{samples_path}` — Prometheus samples during the run",
    "",
]

with open(report_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print(f"Wrote {report_path}")
print()
print("--- Resume blurb ---")
print(lines[lines.index("## Resume blurb (copy/paste)") + 2])
PY

echo ""
echo "Done."
echo "  Report:  ${REPORT_FILE}"
echo "  Grafana: http://localhost:3000  (dashboards → EventCart → EventCart Load Test)"
echo "  Samples: ${SAMPLES_FILE}"
