package com.eventcart.orderservice.admin;

import com.eventcart.orderservice.OrderStatus;
import com.eventcart.orderservice.persistence.SagaStateEntity;
import com.eventcart.orderservice.persistence.SagaStateJpaRepository;
import com.eventcart.orderservice.persistence.SagaStepEntity;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Component
@Profile("postgres")
public class PostgresSagaStateStore implements SagaStateStore {

    private final SagaStateJpaRepository repository;

    public PostgresSagaStateStore(SagaStateJpaRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    public void recordStep(String orderId, OrderStatus currentStatus, SagaStepName step, String eventType,
            SagaStepOutcome outcome) {
        SagaStateEntity entity = repository.findById(orderId)
                .orElseGet(() -> new SagaStateEntity(orderId, currentStatus));
        entity.setCurrentStatus(currentStatus);
        entity.addStep(step, eventType, outcome);
        repository.save(entity);
    }

    @Override
    @Transactional(readOnly = true)
    public List<SagaInstanceView> findRecent(int limit) {
        return repository.findTop50ByOrderByUpdatedAtDesc().stream()
                .limit(Math.max(1, limit))
                .map(this::toView)
                .toList();
    }

    private SagaInstanceView toView(SagaStateEntity entity) {
        List<SagaStepView> steps = entity.getSteps().stream()
                .map(this::toStepView)
                .toList();
        return new SagaInstanceView(
                entity.getOrderId(),
                entity.getCurrentStatus().name(),
                steps,
                entity.getCreatedAt(),
                entity.getUpdatedAt());
    }

    private SagaStepView toStepView(SagaStepEntity step) {
        return new SagaStepView(step.getStep(), step.getEventType(), step.getOutcome(), step.getRecordedAt());
    }
}
