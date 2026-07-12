package com.eventcart.orderservice.admin;

import com.eventcart.orderservice.OrderStatus;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
@Profile("!postgres")
public class InMemorySagaStateStore implements SagaStateStore {

    private final Map<String, MutableSaga> byOrderId = new ConcurrentHashMap<>();

    @Override
    public void recordStep(String orderId, OrderStatus currentStatus, SagaStepName step, String eventType,
            SagaStepOutcome outcome) {
        Instant now = Instant.now();
        byOrderId.compute(orderId, (id, existing) -> {
            MutableSaga saga = existing != null ? existing : new MutableSaga(id, now);
            saga.currentStatus = currentStatus.name();
            saga.updatedAt = now;
            saga.steps.add(new SagaStepView(step, eventType, outcome, now));
            return saga;
        });
    }

    @Override
    public List<SagaInstanceView> findRecent(int limit) {
        return byOrderId.values().stream()
                .sorted(Comparator.comparing((MutableSaga s) -> s.updatedAt).reversed())
                .limit(Math.max(1, limit))
                .map(s -> new SagaInstanceView(s.orderId, s.currentStatus, List.copyOf(s.steps), s.createdAt,
                        s.updatedAt))
                .toList();
    }

    private static final class MutableSaga {
        private final String orderId;
        private final Instant createdAt;
        private Instant updatedAt;
        private String currentStatus;
        private final List<SagaStepView> steps = new ArrayList<>();

        private MutableSaga(String orderId, Instant createdAt) {
            this.orderId = orderId;
            this.createdAt = createdAt;
            this.updatedAt = createdAt;
            this.currentStatus = OrderStatus.PENDING.name();
        }
    }
}
