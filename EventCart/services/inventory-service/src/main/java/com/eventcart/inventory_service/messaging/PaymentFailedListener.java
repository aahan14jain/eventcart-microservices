package com.eventcart.inventory_service.messaging;

import com.eventcart.inventory_service.events.InventoryReleasedEvent;
import com.eventcart.inventory_service.idempotency.IdempotencyService;
import com.eventcart.inventory_service.metrics.SagaMetrics;
import com.eventcart.inventory_service.observability.LogMdc;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class PaymentFailedListener {

    private static final Logger log = LoggerFactory.getLogger(PaymentFailedListener.class);
    private static final String NO_EVENT_ID = "n/a";

    private static final String EVENT_PAYMENT_FAILED = "payment.failed";

    private final ObjectMapper objectMapper;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final IdempotencyService idempotencyService;
    private final SagaMetrics sagaMetrics;

    public PaymentFailedListener(ObjectMapper objectMapper, KafkaTemplate<String, Object> kafkaTemplate,
            IdempotencyService idempotencyService, SagaMetrics sagaMetrics) {
        this.objectMapper = objectMapper;
        this.kafkaTemplate = kafkaTemplate;
        this.idempotencyService = idempotencyService;
        this.sagaMetrics = sagaMetrics;
    }

    @KafkaListener(topics = "payment.failed", groupId = "inventory-group")
    public void onPaymentFailed(String message) {
        try (var ignored = LogMdc.eventType(EVENT_PAYMENT_FAILED)) {
            JsonNode root = objectMapper.readTree(message);
            String orderId = root.has("orderId") ? root.get("orderId").asText() : null;
            if (orderId == null) {
                log.warn("event processed: eventType={} orderId={} eventId={} result={}",
                        EVENT_PAYMENT_FAILED, "unknown", NO_EVENT_ID, "invalid_payload");
                return;
            }

            if (!claimFirstProcessingOrLogDuplicate(orderId)) {
                return;
            }

            InventoryReleasedEvent event = new InventoryReleasedEvent(orderId);
            kafkaTemplate.send("inventory.released", orderId, event);
            sagaMetrics.stepCompleted(SagaMetrics.STEP_INVENTORY_RELEASED);
            log.info("event processed: eventType={} orderId={} eventId={} result={} reason={}",
                    "inventory.released", orderId, NO_EVENT_ID, "published", "compensation");
        } catch (Exception e) {
            sagaMetrics.stepFailed(SagaMetrics.STEP_INVENTORY_RELEASED);
            log.error("event processed: eventType={} orderId={} eventId={} result={} error={}",
                    EVENT_PAYMENT_FAILED, "unknown", NO_EVENT_ID, "handler_failed", e.getMessage());
        }
    }

    /**
     * Idempotency + demo logs. @return {@code true} if first processing; {@code false} if duplicate (already logged).
     */
    private boolean claimFirstProcessingOrLogDuplicate(String orderId) {
        if (!idempotencyService.markIfNotProcessed(EVENT_PAYMENT_FAILED, orderId)) {
            log.info("event processed: eventType={} orderId={} eventId={} result={}",
                    EVENT_PAYMENT_FAILED, orderId, NO_EVENT_ID, "duplicate_ignored");
            return false;
        }
        return true;
    }
}
