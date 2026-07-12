package com.eventcart.orderservice.persistence;

import com.eventcart.orderservice.admin.SagaStepName;
import com.eventcart.orderservice.admin.SagaStepOutcome;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "saga_step")
public class SagaStepEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false)
    private SagaStateEntity sagaState;

    @Enumerated(EnumType.STRING)
    @Column(name = "step", nullable = false, length = 32)
    private SagaStepName step;

    @Column(name = "event_type", nullable = false, length = 64)
    private String eventType;

    @Enumerated(EnumType.STRING)
    @Column(name = "outcome", nullable = false, length = 16)
    private SagaStepOutcome outcome;

    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt;

    public SagaStepEntity() {
    }

    public SagaStepEntity(SagaStateEntity sagaState, SagaStepName step, String eventType, SagaStepOutcome outcome) {
        this.sagaState = sagaState;
        this.step = step;
        this.eventType = eventType;
        this.outcome = outcome;
    }

    @PrePersist
    void onCreate() {
        this.recordedAt = Instant.now();
    }

    public Long getId() {
        return id;
    }

    public SagaStepName getStep() {
        return step;
    }

    public String getEventType() {
        return eventType;
    }

    public SagaStepOutcome getOutcome() {
        return outcome;
    }

    public Instant getRecordedAt() {
        return recordedAt;
    }
}
