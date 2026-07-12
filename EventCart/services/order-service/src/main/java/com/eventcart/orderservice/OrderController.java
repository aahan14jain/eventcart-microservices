package com.eventcart.orderservice;

import com.eventcart.orderservice.cache.RedisOrderCacheService;
import com.eventcart.orderservice.events.OrderCreatedEvent;
import com.eventcart.orderservice.messaging.OrderEventPublisher;
import com.eventcart.orderservice.metrics.SagaMetrics;
import com.eventcart.orderservice.admin.SagaAdminService;
import com.eventcart.orderservice.observability.CorrelationId;
import com.eventcart.orderservice.observability.LogMdc;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** Writes always go to {@link OrderStore} first; Redis mirrors status for reads. */
@RestController
@RequestMapping("/orders")
public class OrderController {

    private static final Logger log = LoggerFactory.getLogger(OrderController.class);
    private static final String NO_EVENT_ID = "n/a";

    private final OrderStore orderStore;
    private final OrderEventPublisher orderEventPublisher;
    private final RedisOrderCacheService redisOrderCacheService;
    private final SagaMetrics sagaMetrics;
    private final SagaAdminService sagaAdminService;

    public OrderController(OrderStore orderStore, OrderEventPublisher orderEventPublisher,
            RedisOrderCacheService redisOrderCacheService, SagaMetrics sagaMetrics,
            SagaAdminService sagaAdminService) {
        this.orderStore = orderStore;
        this.orderEventPublisher = orderEventPublisher;
        this.redisOrderCacheService = redisOrderCacheService;
        this.sagaMetrics = sagaMetrics;
        this.sagaAdminService = sagaAdminService;
    }

    @GetMapping("/hello")
    public String hello() {
        return "Order Service is running 🚀";
    }

    @PostMapping
    public CreateOrderResponse createOrder(
            @RequestAttribute(CorrelationId.REQUEST_ATTRIBUTE) String correlationId,
            @RequestBody CreateOrderRequest request) {
        try (var ignored = LogMdc.eventType(SagaMetrics.STEP_ORDER_CREATED)) {
            String orderId = UUID.randomUUID().toString();
            OrderRecord record = new OrderRecord(orderId, OrderStatus.PENDING, request, correlationId);
            orderStore.save(record);
            redisOrderCacheService.saveOrderStatus(orderId, record.getStatus().name());
            log.info("event processed: eventType={} orderId={} eventId={} result={} status={}",
                    "order.create", orderId, NO_EVENT_ID, "persisted", record.getStatus().name());

            double totalAmount = record.getRequest() != null ? record.getRequest().getTotalAmount() : 0.0;
            OrderCreatedEvent event = new OrderCreatedEvent(
                orderId,
                record.getStatus().name(),
                totalAmount
            );
            if (Boolean.TRUE.equals(request.getForcePaymentFailure())) {
                event.setForcePaymentFailure(true);
            }
            event.setCorrelationId(correlationId);
            orderEventPublisher.publishOrderCreated(event);
            sagaMetrics.stepCompleted(SagaMetrics.STEP_ORDER_CREATED);
            sagaAdminService.recordOrderCreated(orderId);
            log.info("event processed: eventType={} orderId={} eventId={} result={}",
                    "order.created", orderId, NO_EVENT_ID, "publish_initiated");

            return new CreateOrderResponse(orderId, record.getStatus().name());
        }
    }

    @GetMapping("/{orderId}")
    public ResponseEntity<CreateOrderResponse> getOrder(@PathVariable String orderId) {
        return redisOrderCacheService.getOrderStatus(orderId)
                .map(status -> ResponseEntity.ok(new CreateOrderResponse(orderId, status)))
                .orElseGet(() -> orderStore.findById(orderId)
                        .map(record -> {
                            String status = record.getStatus().name();
                            redisOrderCacheService.saveOrderStatus(orderId, status);
                            return ResponseEntity.ok(new CreateOrderResponse(record.getOrderId(), status));
                        })
                        .orElse(ResponseEntity.status(HttpStatus.NOT_FOUND).build()));
    }
}
