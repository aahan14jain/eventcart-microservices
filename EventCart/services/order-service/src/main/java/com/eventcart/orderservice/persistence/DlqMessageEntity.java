package com.eventcart.orderservice.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "dlq_message")
public class DlqMessageEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false, length = 64)
    private String id;

    @Column(name = "topic", nullable = false, length = 128)
    private String topic;

    @Column(name = "partition_num", nullable = false)
    private int partition;

    @Column(name = "msg_offset", nullable = false)
    private long offset;

    @Column(name = "original_topic", nullable = false, length = 128)
    private String originalTopic;

    @Lob
    @Column(name = "payload", nullable = false, columnDefinition = "TEXT")
    private String payload;

    @Column(name = "received_at", nullable = false, updatable = false)
    private Instant receivedAt;

    @Column(name = "replayed", nullable = false)
    private boolean replayed;

    public DlqMessageEntity() {
    }

    public DlqMessageEntity(String id, String topic, int partition, long offset, String originalTopic, String payload) {
        this.id = id;
        this.topic = topic;
        this.partition = partition;
        this.offset = offset;
        this.originalTopic = originalTopic;
        this.payload = payload;
        this.replayed = false;
    }

    @PrePersist
    void onCreate() {
        this.receivedAt = Instant.now();
    }

    public String getId() {
        return id;
    }

    public String getTopic() {
        return topic;
    }

    public int getPartition() {
        return partition;
    }

    public long getOffset() {
        return offset;
    }

    public String getOriginalTopic() {
        return originalTopic;
    }

    public String getPayload() {
        return payload;
    }

    public Instant getReceivedAt() {
        return receivedAt;
    }

    public boolean isReplayed() {
        return replayed;
    }

    public void setReplayed(boolean replayed) {
        this.replayed = replayed;
    }
}
