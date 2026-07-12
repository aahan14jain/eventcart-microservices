package com.eventcart.inventory_service.observability;

import org.slf4j.MDC;

/**
 * MDC keys for structured JSON logs (CloudWatch). Use with try-with-resources for event type.
 */
public final class LogMdc {

    public static final String TRACE_ID = "traceId";
    public static final String CORRELATION_ID = "correlationId";
    public static final String EVENT_TYPE = "eventType";

    private LogMdc() {
    }

    public static void putTraceId(String traceId) {
        if (traceId == null || traceId.isBlank()) {
            return;
        }
        MDC.put(TRACE_ID, traceId);
        MDC.put(CORRELATION_ID, traceId);
    }

    public static void clearTraceId() {
        MDC.remove(TRACE_ID);
        MDC.remove(CORRELATION_ID);
    }

    /** Puts {@code eventType} in MDC; remove via {@link Scope#close()}. */
    public static Scope eventType(String eventType) {
        if (eventType != null && !eventType.isBlank()) {
            MDC.put(EVENT_TYPE, eventType);
        }
        return () -> MDC.remove(EVENT_TYPE);
    }

    /** AutoCloseable that does not declare checked exceptions (safe in controllers). */
    @FunctionalInterface
    public interface Scope extends AutoCloseable {
        @Override
        void close();
    }
}
