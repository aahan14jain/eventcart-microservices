package com.eventcart.orderservice.admin;

import com.eventcart.orderservice.OrderStatus;

import java.util.List;

/**
 * Queryable saga visibility store (orthogonal to choreography).
 */
public interface SagaStateStore {

    void recordStep(String orderId, OrderStatus currentStatus, SagaStepName step, String eventType,
            SagaStepOutcome outcome);

    List<SagaInstanceView> findRecent(int limit);
}
