import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

/**
 * Order-service base URL. Empty uses same-origin paths so the CRA dev server
 * proxy (package.json → localhost:8080) avoids browser CORS in dev.
 */
const orderServiceBase = (process.env.REACT_APP_ORDER_SERVICE_URL || "").replace(
  /\/$/,
  ""
);

const demoPayload = {
  items: [{ sku: "SKU-1", quantity: 1 }],
  totalAmount: 19.99,
};

function correlationIdFromResponse(res) {
  const h = res?.headers || {};
  const fromHeader = h["x-correlation-id"] ?? h["X-Correlation-Id"];
  const fromBody = res?.data?.correlationId;
  const pick = (v) => (typeof v === "string" ? v.trim() : "");
  return pick(fromHeader) || pick(fromBody);
}

function formatHttpError(e, label, { treat404AsMissingOrder = false } = {}) {
  if (axios.isAxiosError(e)) {
    const status = e.response?.status;
    if (treat404AsMissingOrder && status === 404) {
      return "Order not found";
    }
    const data = e.response?.data;
    let detail = "";
    if (typeof data === "string") detail = data.trim().slice(0, 300);
    else if (data && typeof data === "object") {
      const m = data.message ?? data.error ?? data.title;
      if (m != null) detail = String(m).trim().slice(0, 300);
    }
    if (status != null) {
      return detail ? `${label} failed (${status}): ${detail}` : `${label} failed (${status})`;
    }
    if (e.code === "ECONNABORTED") return `${label} timed out`;
    return e.message ? `${label}: ${e.message}` : `${label} failed (network)`;
  }
  if (e instanceof Error) return `${label}: ${e.message}`;
  return `${label} failed`;
}

const DEMO_FLOW_STEPS = [
  "Order created",
  "Inventory reserved",
  "Payment processed",
  "Final status",
];

function demoFlowActiveIndex(orderId, statusRaw) {
  if (!orderId?.trim()) return -1;
  const s = (statusRaw || "").toUpperCase();
  if (s === "PENDING") return 0;
  if (s === "RESERVED") return 1;
  if (s === "PAID") return 2;
  if (s === "CONFIRMED" || s === "FAILED") return 3;
  return 0;
}

function App() {
  const api = useMemo(
    () =>
      axios.create({
        baseURL: orderServiceBase || undefined,
        headers: { "Content-Type": "application/json" },
      }),
    []
  );

  const [orderId, setOrderId] = useState("");
  const [correlationId, setCorrelationId] = useState("");
  const [status, setStatus] = useState("");
  const [forcePaymentFailure, setForcePaymentFailure] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState(null);

  const clearBanner = useCallback(() => setBanner(null), []);

  const dismissErrorBannerOnly = useCallback(() => {
    setBanner((prev) => (prev?.kind === "error" ? null : prev));
  }, []);

  const resetDemo = useCallback(() => {
    setOrderId("");
    setStatus("");
    setCorrelationId("");
    clearBanner();
  }, [clearBanner]);

  const createOrder = useCallback(async () => {
    clearBanner();
    setLoading(true);
    try {
      const body = {
        ...demoPayload,
        ...(forcePaymentFailure ? { forcePaymentFailure: true } : {}),
      };
      const res = await api.post("/orders", body);
      const { data } = res;
      setOrderId(data.orderId ?? "");
      setStatus(data.status ?? "");
      setCorrelationId(correlationIdFromResponse(res));
      setBanner({ kind: "success", message: "Order created — saga is in motion." });
    } catch (e) {
      setBanner({ kind: "error", message: formatHttpError(e, "Create order") });
    } finally {
      setLoading(false);
    }
  }, [api, forcePaymentFailure, clearBanner]);

  const refreshStatus = useCallback(async () => {
    if (!orderId.trim()) return;
    clearBanner();
    setRefreshing(true);
    try {
      const res = await api.get(`/orders/${encodeURIComponent(orderId.trim())}`);
      const { data } = res;
      setOrderId(data.orderId ?? orderId);
      setStatus(data.status ?? "");
      setCorrelationId(correlationIdFromResponse(res));
      dismissErrorBannerOnly();
    } catch (e) {
      setBanner({
        kind: "error",
        message: formatHttpError(e, "Load order", { treat404AsMissingOrder: true }),
      });
    } finally {
      setRefreshing(false);
    }
  }, [api, orderId, clearBanner, dismissErrorBannerOnly]);

  useEffect(() => {
    const id = orderId.trim();
    if (!id) return;

    const current = (status || "").toUpperCase();
    if (current === "CONFIRMED" || current === "FAILED") {
      return;
    }

    let cancelled = false;
    let intervalId;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await api.get(`/orders/${encodeURIComponent(id)}`);
        if (cancelled) return;
        const { data } = res;
        const next = (data.status ?? "").toUpperCase();
        setOrderId(data.orderId ?? id);
        setStatus(data.status ?? "");
        setCorrelationId(correlationIdFromResponse(res));
        dismissErrorBannerOnly();
        if (next === "CONFIRMED" || next === "FAILED") {
          clearInterval(intervalId);
        }
      } catch (e) {
        if (cancelled) return;
        setBanner({
          kind: "error",
          message: formatHttpError(e, "Poll order", { treat404AsMissingOrder: true }),
        });
      }
    };

    intervalId = setInterval(() => {
      void poll();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [orderId, status, api, dismissErrorBannerOnly]);

  const canRefresh = Boolean(orderId.trim()) && !loading && !refreshing;
  const asyncBusy = loading || refreshing;
  const statusKey = (status || "").toUpperCase();
  const demoFlowStepIndex = demoFlowActiveIndex(orderId, status);

  return (
    <div className="shell">
      <div className="shell-inner">
        <h1 className="brand">
          Cho<span>reo</span>
        </h1>
        <p className="lede">
          Watch a checkout saga move across services — order, inventory, payment — in real time.
        </p>

        {banner ? (
          <div
            className={`banner ${banner.kind === "success" ? "ok" : "err"}`}
            role={banner.kind === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {banner.message}
          </div>
        ) : null}

        <div className="controls">
          <label className="toggle" htmlFor="forcePaymentFailure">
            <input
              id="forcePaymentFailure"
              type="checkbox"
              checked={forcePaymentFailure}
              onChange={(e) => setForcePaymentFailure(e.target.checked)}
              disabled={asyncBusy}
            />
            Force payment failure
          </label>

          <div className="cta-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || refreshing}
              onClick={createOrder}
              aria-busy={loading}
            >
              {loading ? "Creating…" : "Start checkout"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!canRefresh}
              onClick={refreshStatus}
              aria-busy={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={resetDemo}
              disabled={asyncBusy}
            >
              Reset
            </button>
          </div>
        </div>

        <section className="panel" aria-label="Order details">
          <div className="meta-grid">
            <div>
              <div className="meta-label">Order ID</div>
              <div className="mono">{orderId || <span className="empty">—</span>}</div>
            </div>
            <div>
              <div className="meta-label">Correlation ID</div>
              <div className="mono">{correlationId || <span className="empty">—</span>}</div>
            </div>
            <div>
              <div className="meta-label">Status</div>
              {status ? (
                <span className={`status-chip status-${statusKey}`}>{statusKey}</span>
              ) : (
                <span className="empty">—</span>
              )}
            </div>
          </div>
        </section>

        <section className="flow" aria-label="Saga flow">
          <h2 className="flow-title">Saga path</h2>
          <ol className="timeline">
            {DEMO_FLOW_STEPS.map((label, i) => {
              const isCurrent = demoFlowStepIndex === i;
              const isPast = demoFlowStepIndex > i;
              return (
                <li
                  key={label}
                  className={`step${isCurrent ? " current" : ""}${isPast ? " past" : ""}`}
                >
                  <span className="step-dot" aria-hidden="true" />
                  <span className="step-label">{label}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="links" aria-label="Observability">
          <h2 className="links-title">Observability</h2>
          <ul>
            {[
              { label: "Prometheus", href: "http://localhost:9090" },
              { label: "Grafana", href: "http://localhost:3000" },
              { label: "Kafka UI", href: "http://localhost:8085" },
            ].map(({ label, href }) => (
              <li key={label}>
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export default App;
