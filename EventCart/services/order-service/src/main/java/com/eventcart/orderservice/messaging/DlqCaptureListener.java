package com.eventcart.orderservice.messaging;

import com.eventcart.orderservice.admin.DlqMessageStore;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.header.Header;
import org.apache.kafka.common.header.Headers;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

/**
 * Captures dead-lettered saga events for the admin DLQ API (does not alter happy-path orchestration).
 */
@Component
public class DlqCaptureListener {

    private static final Logger log = LoggerFactory.getLogger(DlqCaptureListener.class);

    private final DlqMessageStore dlqMessageStore;

    public DlqCaptureListener(DlqMessageStore dlqMessageStore) {
        this.dlqMessageStore = dlqMessageStore;
    }

    @KafkaListener(
            topics = {
                    "inventory.reserved.DLT",
                    "inventory.failed.DLT",
                    "payment.succeeded.DLT",
                    "payment.failed.DLT"
            },
            groupId = "order-dlq-group")
    public void onDeadLetter(ConsumerRecord<String, String> record) {
        String originalTopic = resolveOriginalTopic(record);
        String payload = record.value() != null ? record.value() : "";
        var saved = dlqMessageStore.save(record.topic(), record.partition(), record.offset(), originalTopic, payload);
        log.warn("DLQ captured: id={} topic={} partition={} offset={} originalTopic={}",
                saved.id(), saved.topic(), saved.partition(), saved.offset(), saved.originalTopic());
    }

    private static String resolveOriginalTopic(ConsumerRecord<String, String> record) {
        Headers headers = record.headers();
        Header header = headers.lastHeader(KafkaHeaders.DLT_ORIGINAL_TOPIC);
        if (header != null && header.value() != null) {
            return new String(header.value(), StandardCharsets.UTF_8);
        }
        String topic = record.topic();
        if (topic != null && topic.endsWith(".DLT")) {
            return topic.substring(0, topic.length() - 4);
        }
        return topic != null ? topic : "unknown";
    }
}
