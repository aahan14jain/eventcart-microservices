package com.eventcart.orderservice.admin;

import java.time.Instant;

public record SagaStepView(
        SagaStepName step,
        String eventType,
        SagaStepOutcome outcome,
        Instant recordedAt
) {
}
