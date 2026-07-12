package com.eventcart.payment_service.messaging;

import com.eventcart.payment_service.events.PaymentFailedEvent;
import com.eventcart.payment_service.events.PaymentSucceededEvent;
import com.eventcart.payment_service.idempotency.IdempotencyService;
import com.eventcart.payment_service.metrics.SagaMetrics;
import com.eventcart.payment_service.observability.LogMdc;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class InventoryReservedListener {

    private static final Logger log = LoggerFactory.getLogger(InventoryReservedListener.class);

    private static final String EVENT_INVENTORY_RESERVED = "inventory.reserved";

    private final ObjectMapper objectMapper;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final IdempotencyService idempotencyService;
    private final SagaMetrics sagaMetrics;

    public InventoryReservedListener(ObjectMapper objectMapper, KafkaTemplate<String, Object> kafkaTemplate,
            IdempotencyService idempotencyService, SagaMetrics sagaMetrics) {
        this.objectMapper = objectMapper;
        this.kafkaTemplate = kafkaTemplate;
        this.idempotencyService = idempotencyService;
        this.sagaMetrics = sagaMetrics;
    }

    @KafkaListener(topics = "inventory.reserved", groupId = "payment-group")
    public void onInventoryReserved(String message) {
        try (var ignored = LogMdc.eventType(EVENT_INVENTORY_RESERVED)) {
            log.info("inventory.reserved incoming json={}", message);
            JsonNode root = objectMapper.readTree(message);
            String orderId = root.has("orderId") ? root.get("orderId").asText() : null;
            if (orderId == null) {
                log.warn("Payment received event with no orderId: {}", message);
                return;
            }

            if (!claimFirstProcessingOrLogDuplicate(orderId)) {
                return;
            }

            boolean forceFailure = root.has("forcePaymentFailure") && root.get("forcePaymentFailure").asBoolean();
            boolean failPayMatch = orderId.toLowerCase().contains("fail-pay");
            boolean payfailPrefix = orderId.startsWith("PAYFAIL");
            boolean shouldFail = forceFailure || failPayMatch || payfailPrefix;
            log.info(
                    "payment shouldFail decision: orderId={} forcePaymentFailure={} failPayMatch={} payfailPrefix={} shouldFail={}",
                    orderId, forceFailure, failPayMatch, payfailPrefix, shouldFail);
            if (shouldFail) {
                PaymentFailedEvent event = new PaymentFailedEvent(orderId, "PAYMENT_DECLINED");
                kafkaTemplate.send("payment.failed", orderId, event);
                sagaMetrics.stepFailed(SagaMetrics.STEP_PAYMENT_FAILED);
                log.info("Published payment.failed: orderId={}, reason=PAYMENT_DECLINED", orderId);
            } else {
                PaymentSucceededEvent event = new PaymentSucceededEvent(orderId);
                kafkaTemplate.send("payment.succeeded", orderId, event);
                sagaMetrics.stepCompleted(SagaMetrics.STEP_PAYMENT_SUCCEEDED);
                log.info("Published payment.succeeded: orderId={}", orderId);
            }
        } catch (Exception e) {
            sagaMetrics.stepFailed(EVENT_INVENTORY_RESERVED);
            log.error("Failed to process inventory.reserved message: {}", e.getMessage());
        }
    }

    /**
     * Idempotency + demo logs. @return {@code true} if first processing; {@code false} if duplicate (already logged).
     */
    private boolean claimFirstProcessingOrLogDuplicate(String orderId) {
        if (!idempotencyService.markIfNotProcessed(EVENT_INVENTORY_RESERVED, orderId)) {
            log.info("Duplicate event ignored: inventory.reserved for order {}", orderId);
            return false;
        }
        log.info("Processing inventory.reserved for order {}: charging payment", orderId);
        return true;
    }
}
