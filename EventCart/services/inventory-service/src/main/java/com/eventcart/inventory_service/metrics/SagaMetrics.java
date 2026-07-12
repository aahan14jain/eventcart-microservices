package com.eventcart.inventory_service.metrics;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/**
 * Custom saga-step counters exported to Prometheus and CloudWatch (when enabled).
 */
@Component
public class SagaMetrics {

    public static final String STEP_INVENTORY_RESERVED = "inventory.reserved";
    public static final String STEP_INVENTORY_FAILED = "inventory.failed";
    public static final String STEP_INVENTORY_RELEASED = "inventory.released";

    private final MeterRegistry meterRegistry;

    public SagaMetrics(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    public void stepCompleted(String step) {
        meterRegistry.counter("saga.step.completions", "step", step).increment();
    }

    public void stepFailed(String step) {
        meterRegistry.counter("saga.step.failures", "step", step).increment();
    }
}
