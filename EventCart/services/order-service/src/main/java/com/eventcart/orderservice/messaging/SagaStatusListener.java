package com.eventcart.orderservice.messaging;

import com.eventcart.orderservice.OrderRecord;
import com.eventcart.orderservice.OrderStatus;
import com.eventcart.orderservice.OrderStore;
import com.eventcart.orderservice.admin.SagaAdminService;
import com.eventcart.orderservice.cache.RedisOrderCacheService;
import com.eventcart.orderservice.idempotency.IdempotencyService;
import com.eventcart.orderservice.metrics.SagaMetrics;
import com.eventcart.orderservice.observability.LogMdc;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Consumes saga topics (inventory / payment). Duplicates are dropped in {@link #shouldProcess} before
 * {@link com.eventcart.orderservice.OrderStore} or status cache updates.
 */
@Component
public class SagaStatusListener {

    private static final Logger log = LoggerFactory.getLogger(SagaStatusListener.class);
    private static final String NO_EVENT_ID = "n/a";

    private static final String EVENT_INVENTORY_RESERVED = "inventory.reserved";
    private static final String EVENT_INVENTORY_FAILED = "inventory.failed";
    private static final String EVENT_PAYMENT_SUCCEEDED = "payment.succeeded";
    private static final String EVENT_PAYMENT_FAILED = "payment.failed";

    private final ObjectMapper objectMapper;
    private final OrderStore orderStore;
    private final IdempotencyService idempotencyService;
    private final RedisOrderCacheService redisOrderCacheService;
    private final SagaMetrics sagaMetrics;
    private final SagaAdminService sagaAdminService;

    public SagaStatusListener(ObjectMapper objectMapper, OrderStore orderStore,
            IdempotencyService idempotencyService, RedisOrderCacheService redisOrderCacheService,
            SagaMetrics sagaMetrics, SagaAdminService sagaAdminService) {
        this.objectMapper = objectMapper;
        this.orderStore = orderStore;
        this.idempotencyService = idempotencyService;
        this.redisOrderCacheService = redisOrderCacheService;
        this.sagaMetrics = sagaMetrics;
        this.sagaAdminService = sagaAdminService;
    }

    @KafkaListener(topics = "inventory.reserved", groupId = "order-group")
    public void onInventoryReserved(String message) {
        handle(message, EVENT_INVENTORY_RESERVED, OrderStatus.RESERVED);
    }

    @KafkaListener(topics = "inventory.failed", groupId = "order-group")
    public void onInventoryFailed(String message) {
        handle(message, EVENT_INVENTORY_FAILED, OrderStatus.FAILED);
    }

    @KafkaListener(topics = "payment.succeeded", groupId = "order-group")
    public void onPaymentSucceeded(String message) {
        handle(message, EVENT_PAYMENT_SUCCEEDED, OrderStatus.CONFIRMED);
    }

    @KafkaListener(topics = "payment.failed", groupId = "order-group")
    public void onPaymentFailed(String message) {
        handle(message, EVENT_PAYMENT_FAILED, OrderStatus.FAILED);
    }

    private void handle(String message, String eventType, OrderStatus newStatus) {
        try (var ignored = LogMdc.eventType(eventType)) {
            String orderId = extractOrderId(message, eventType);
            if (orderId == null) {
                return;
            }
            if (!shouldProcess(eventType, orderId)) {
                return;
            }
            persistOrderStatus(orderId, newStatus, eventType);
        } catch (RuntimeException e) {
            sagaMetrics.stepFailed(eventType);
            log.error("event processed: eventType={} orderId={} eventId={} result={} error={}",
                    eventType, "unknown", NO_EVENT_ID, "handler_failed", e.getMessage());
            // Re-throw so DefaultErrorHandler can publish to <topic>.DLT for admin visibility.
            throw e;
        }
    }

    /**
     * Redis idempotency before any OrderStore update.
     *
     * @return {@code true} if first processing for this (eventType, orderId); {@code false} if duplicate.
     */
    private boolean shouldProcess(String eventType, String orderId) {
        if (!idempotencyService.markIfNotProcessed(eventType, orderId)) {
            log.info("event processed: eventType={} orderId={} eventId={} result={}",
                    eventType, orderId, NO_EVENT_ID, "duplicate_ignored");
            return false;
        }
        return true;
    }

    /** Updates store + Redis status cache when the order exists. */
    private void persistOrderStatus(String orderId, OrderStatus targetStatus, String eventType) {
        OrderStatus previous = orderStore.findById(orderId).map(OrderRecord::getStatus).orElse(null);
        orderStore.updateStatus(orderId, targetStatus).ifPresentOrElse(
                record -> {
                    OrderStatus updated = record.getStatus();
                    redisOrderCacheService.saveOrderStatus(orderId, updated.name());
                    sagaAdminService.recordSagaEvent(orderId, updated, eventType);
                    if (updated == OrderStatus.FAILED) {
                        sagaMetrics.stepFailed(eventType);
                    } else {
                        sagaMetrics.stepCompleted(eventType);
                    }
                    log.info("event processed: eventType={} orderId={} eventId={} result={} fromStatus={} toStatus={}",
                            eventType, orderId, NO_EVENT_ID, "ok", previous, updated);
                },
                () -> {
                    sagaMetrics.stepFailed(eventType);
                    log.warn("event processed: eventType={} orderId={} eventId={} result={}",
                            eventType, orderId, NO_EVENT_ID, "order_not_found");
                });
    }

    private String extractOrderId(String message, String eventType) {
        try {
            JsonNode root = objectMapper.readTree(message);
            if (!root.has("orderId") || root.get("orderId").isNull()) {
                log.warn("event processed: eventType={} orderId={} eventId={} result={}",
                        eventType, "unknown", NO_EVENT_ID, "missing_orderId");
                return null;
            }
            String id = root.get("orderId").asText();
            return id != null && !id.isBlank() ? id : null;
        } catch (Exception e) {
            log.warn("event processed: eventType={} orderId={} eventId={} result={} error={}",
                    eventType, "unknown", NO_EVENT_ID, "parse_failed", e.getMessage());
            return null;
        }
    }
}
