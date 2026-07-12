package com.eventcart.inventory_service.messaging;

import com.eventcart.inventory_service.events.InventoryFailedEvent;
import com.eventcart.inventory_service.events.InventoryReservedEvent;
import com.eventcart.inventory_service.idempotency.IdempotencyService;
import com.eventcart.inventory_service.metrics.SagaMetrics;
import com.eventcart.inventory_service.observability.LogMdc;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

@Component
public class OrderCreatedListener {

    private static final Logger log = LoggerFactory.getLogger(OrderCreatedListener.class);
    private static final String NO_EVENT_ID = "n/a";

    private static final String EVENT_ORDER_CREATED = "order.created";
    /** Same as order-service Kafka header name, MDC key, and JSON field. */
    private static final String CORRELATION_ID_KEY = "correlationId";

    private final ObjectMapper objectMapper;
    private final KafkaTemplate<String, Object> kafkaTemplate;
    private final IdempotencyService idempotencyService;
    private final SagaMetrics sagaMetrics;

    public OrderCreatedListener(ObjectMapper objectMapper, KafkaTemplate<String, Object> kafkaTemplate,
            IdempotencyService idempotencyService, SagaMetrics sagaMetrics) {
        this.objectMapper = objectMapper;
        this.kafkaTemplate = kafkaTemplate;
        this.idempotencyService = idempotencyService;
        this.sagaMetrics = sagaMetrics;
    }

    @KafkaListener(topics = "order.created", groupId = "inventory-group")
    public void onOrderCreated(
            @Payload String message,
            @Header(name = CORRELATION_ID_KEY, required = false) byte[] correlationIdHeader) {
        try (var ignored = LogMdc.eventType(EVENT_ORDER_CREATED)) {
            JsonNode root = objectMapper.readTree(message);
            String orderId = root.has("orderId") ? root.get("orderId").asText() : null;
            String correlationId = resolveCorrelationId(correlationIdHeader, root);
            if (correlationId != null) {
                LogMdc.putTraceId(correlationId);
            }
            try {
                if (orderId == null) {
                    log.warn("event processed: eventType={} orderId={} eventId={} result={}",
                            EVENT_ORDER_CREATED, "unknown", NO_EVENT_ID, "invalid_payload");
                    return;
                }
                if (!idempotencyService.markIfNotProcessed(EVENT_ORDER_CREATED, orderId)) {
                    log.info("event processed: eventType={} orderId={} eventId={} result={}",
                            EVENT_ORDER_CREATED, orderId, NO_EVENT_ID, "duplicate_ignored");
                    return;
                }

                if (message.contains("\"sku\":\"FAIL\"") || message.contains("\"sku\": \"FAIL\"")) {
                    InventoryFailedEvent event = new InventoryFailedEvent(orderId, "OUT_OF_STOCK");
                    kafkaTemplate.send("inventory.failed", orderId, event);
                    sagaMetrics.stepFailed(SagaMetrics.STEP_INVENTORY_FAILED);
                    log.info("event processed: eventType={} orderId={} eventId={} result={} status={}",
                            "inventory.failed", orderId, NO_EVENT_ID, "published", "OUT_OF_STOCK");
                } else {
                    InventoryReservedEvent event = new InventoryReservedEvent(orderId);
                    if (root.has("forcePaymentFailure") && root.get("forcePaymentFailure").asBoolean()) {
                        event.setForcePaymentFailure(true);
                    }
                    kafkaTemplate.send("inventory.reserved", orderId, event);
                    sagaMetrics.stepCompleted(SagaMetrics.STEP_INVENTORY_RESERVED);
                    log.info("event processed: eventType={} orderId={} eventId={} result={} status={}",
                            "inventory.reserved", orderId, NO_EVENT_ID, "published", "RESERVED");
                }
            } finally {
                LogMdc.clearTraceId();
            }
        } catch (Exception e) {
            sagaMetrics.stepFailed(EVENT_ORDER_CREATED);
            log.error("event processed: eventType={} orderId={} eventId={} result={} error={}",
                    EVENT_ORDER_CREATED, "unknown", NO_EVENT_ID, "handler_failed", e.getMessage());
        }
    }

    /**
     * Prefer Kafka header (production-style propagation); fall back to JSON for older producers.
     */
    private static String resolveCorrelationId(byte[] correlationIdHeader, JsonNode root) {
        if (correlationIdHeader != null && correlationIdHeader.length > 0) {
            String v = new String(correlationIdHeader, StandardCharsets.UTF_8).trim();
            if (!v.isEmpty()) {
                return v;
            }
        }
        return extractCorrelationId(root);
    }

    private static String extractCorrelationId(JsonNode root) {
        if (root == null || !root.has("correlationId") || root.get("correlationId").isNull()) {
            return null;
        }
        String v = root.get("correlationId").asText();
        return v != null && !v.isBlank() ? v.trim() : null;
    }
}
