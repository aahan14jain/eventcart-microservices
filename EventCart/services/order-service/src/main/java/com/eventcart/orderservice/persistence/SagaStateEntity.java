package com.eventcart.orderservice.persistence;

import com.eventcart.orderservice.OrderStatus;
import com.eventcart.orderservice.admin.SagaStepName;
import com.eventcart.orderservice.admin.SagaStepOutcome;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Lightweight saga visibility row — does not participate in orchestration.
 */
@Entity
@Table(name = "saga_state")
public class SagaStateEntity {

    @Id
    @Column(name = "order_id", nullable = false, updatable = false, length = 64)
    private String orderId;

    @Enumerated(EnumType.STRING)
    @Column(name = "current_status", nullable = false, length = 32)
    private OrderStatus currentStatus;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @OneToMany(mappedBy = "sagaState", fetch = FetchType.EAGER, cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("recordedAt ASC")
    private List<SagaStepEntity> steps = new ArrayList<>();

    public SagaStateEntity() {
    }

    public SagaStateEntity(String orderId, OrderStatus currentStatus) {
        this.orderId = orderId;
        this.currentStatus = currentStatus;
    }

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = Instant.now();
    }

    public void addStep(SagaStepName step, String eventType, SagaStepOutcome outcome) {
        SagaStepEntity entity = new SagaStepEntity(this, step, eventType, outcome);
        this.steps.add(entity);
    }

    public String getOrderId() {
        return orderId;
    }

    public OrderStatus getCurrentStatus() {
        return currentStatus;
    }

    public void setCurrentStatus(OrderStatus currentStatus) {
        this.currentStatus = currentStatus;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public List<SagaStepEntity> getSteps() {
        return steps;
    }
}
