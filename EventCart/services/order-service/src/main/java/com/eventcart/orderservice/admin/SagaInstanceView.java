package com.eventcart.orderservice.admin;

import java.time.Instant;
import java.util.List;

public record SagaInstanceView(
        String orderId,
        String currentStatus,
        List<SagaStepView> steps,
        Instant createdAt,
        Instant updatedAt
) {
}
