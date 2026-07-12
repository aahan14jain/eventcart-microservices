import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Order-service base URL. Empty uses same-origin paths so the CRA dev server
 * proxy (package.json → localhost:8080) avoids browser CORS in dev.
 * Set REACT_APP_ORDER_SERVICE_URL=http://localhost:8080 if you serve the API with CORS.
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

const base = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  maxWidth: "28rem",
  padding: "1.5rem",
  lineHeight: 1.5,
  color: "#1f2937",
};

const mono = { fontFamily: "ui-monospace, monospace", wordBreak: "break-all" };

const btnBase = {
  padding: "0.45rem 0.85rem",
  fontSize: "0.9rem",
  borderRadius: "6px",
  border: "1px solid #ccc",
  background: "#fff",
};

function statusPillStyle(key) {
  if (key === "PENDING") {
    return { background: "#fef08a", color: "#713f12", border: "1px solid #ca8a04" };
  }
  if (key === "RESERVED") {
    return { background: "#dbeafe", color: "#1e3a8a", border: "1px solid #60a5fa" };
  }
  if (key === "PAID") {
    return { background: "#cffafe", color: "#0e7490", border: "1px solid #22d3ee" };
  }
  if (key === "CONFIRMED") {
    return { background: "#86efac", color: "#14532d", border: "1px solid #16a34a" };
  }
  if (key === "FAILED") {
    return { background: "#fca5a5", color: "#7f1d1d", border: "1px solid #dc2626" };
  }
  return { background: "#e5e5e5", color: "#404040", border: "1px solid #a3a3a3" };
}

const sectionLabel = {
  margin: "0 0 0.6rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#525252",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

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
      setBanner({ kind: "success", message: "Order created." });
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
      const res = await api.get(
        `/orders/${encodeURIComponent(orderId.trim())}`
      );
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
  const statusChipStyle = statusPillStyle(statusKey);
  const demoFlowStepIndex = demoFlowActiveIndex(orderId, status);

  return (
    <main style={base}>
      {banner ? (
        <div
          role={banner.kind === "error" ? "alert" : "status"}
          aria-live="polite"
          style={{
            marginBottom: "1rem",
            padding: "0.5rem 0.7rem",
            fontSize: "0.875rem",
            borderRadius: "6px",
            lineHeight: 1.45,
            ...(banner.kind === "success"
              ? {
                  color: "#166534",
                  background: "#ecfdf5",
                  border: "1px solid #86efac",
                }
              : {
                  color: "#991b1b",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                }),
          }}
        >
          {banner.message}
        </div>
      ) : null}
      <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.35rem", fontWeight: 600 }}>EventCart</h1>
      <p style={{ margin: "0 0 1rem", color: "#4b5563", fontSize: "0.9rem" }}>
        Order-service demo: POST <code style={{ fontSize: "0.85em" }}>/orders</code>, GET{" "}
        <code style={{ fontSize: "0.85em" }}>/orders/{"{orderId}"}</code>
      </p>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "1rem",
          fontSize: "0.9rem",
        }}
      >
        <input
          id="forcePaymentFailure"
          type="checkbox"
          checked={forcePaymentFailure}
          onChange={(e) => setForcePaymentFailure(e.target.checked)}
          disabled={asyncBusy}
        />
        <span>Force payment failure (demo)</span>
      </label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <button
          type="button"
          style={{
            ...btnBase,
            background: loading ? "#e5e5e5" : "#2563eb",
            color: "#fff",
            borderColor: loading ? "#ccc" : "#2563eb",
            cursor: loading ? "wait" : "pointer",
          }}
          disabled={loading || refreshing}
          onClick={createOrder}
          aria-busy={loading}
        >
          {loading ? "Creating…" : "Create order"}
        </button>
        <button
          type="button"
          style={{
            ...btnBase,
            background: "#fff",
            color: "#374151",
            borderColor: "#d1d5db",
            cursor: canRefresh ? "pointer" : "not-allowed",
            opacity: canRefresh ? 1 : 0.55,
          }}
          disabled={!canRefresh}
          onClick={refreshStatus}
          aria-busy={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
        <button
          type="button"
          style={{
            ...btnBase,
            color: "#4b5563",
            background: "#fafafa",
            borderColor: "#d4d4d4",
            cursor: asyncBusy ? "not-allowed" : "pointer",
            opacity: asyncBusy ? 0.55 : 1,
          }}
          onClick={resetDemo}
          disabled={asyncBusy}
        >
          Reset demo
        </button>
      </div>

      <section style={{ marginTop: "1.25rem" }}>
        <div style={{ marginBottom: "0.75rem" }}>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.2rem" }}>orderId</div>
          <div style={mono}>{orderId || "—"}</div>
        </div>
        <div style={{ marginBottom: "0.75rem" }}>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.2rem" }}>correlationId</div>
          <div style={mono}>{correlationId || "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.35rem" }}>status</div>
          {status ? (
            <span
              style={{
                display: "inline-block",
                fontSize: "0.85rem",
                fontWeight: 600,
                letterSpacing: "0.04em",
                padding: "0.35rem 0.7rem",
                borderRadius: "6px",
                ...statusChipStyle,
              }}
            >
              {statusKey}
            </span>
          ) : (
            <span style={{ color: "#9ca3af" }}>—</span>
          )}
        </div>
      </section>

      <section
        style={{
          marginTop: "1.25rem",
          paddingTop: "1rem",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        <h2 style={sectionLabel}>Demo flow</h2>
        <ol
          style={{
            margin: 0,
            paddingLeft: "1.2rem",
            fontSize: "0.85rem",
            lineHeight: 1.65,
          }}
        >
          {DEMO_FLOW_STEPS.map((label, i) => {
            const isCurrent = demoFlowStepIndex === i;
            const isPast = demoFlowStepIndex > i;
            return (
              <li
                key={label}
                style={{
                  marginBottom: "0.1rem",
                  color: isCurrent ? "#111827" : isPast ? "#6b7280" : "#c4c4c4",
                  fontWeight: isCurrent ? 600 : 400,
                  background: isCurrent ? "#f0f9ff" : "transparent",
                  marginLeft: isCurrent ? "-0.25rem" : 0,
                  padding: isCurrent ? "0.15rem 0.4rem 0.15rem 0.25rem" : "0.05rem 0",
                  borderRadius: "4px",
                  borderLeft: isCurrent ? "3px solid #2563eb" : "3px solid transparent",
                  listStylePosition: "outside",
                }}
              >
                {label}
              </li>
            );
          })}
        </ol>
      </section>

      <section
        style={{
          marginTop: "1.25rem",
          paddingTop: "1rem",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        <h2 style={sectionLabel}>System links</h2>
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            fontSize: "0.85rem",
            lineHeight: 1.8,
          }}
        >
          {[
            { label: "Prometheus", href: "http://localhost:9090" },
            { label: "Grafana", href: "http://localhost:3000" },
            { label: "Kafka UI", href: "http://localhost:8085" },
          ].map(({ label, href }) => (
            <li key={label}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#2563eb", textDecoration: "none" }}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default App;
