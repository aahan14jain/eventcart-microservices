package com.eventcart.orderservice.admin;

/**
 * Logical saga step for admin visibility (does not drive orchestration).
 */
public enum SagaStepName {
    ORDER,
    INVENTORY,
    PAYMENT
}
