package com.eventcart.orderservice.admin;

import org.apache.kafka.clients.producer.ProducerRecord;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Service
public class DlqAdminService {

    private final DlqMessageStore dlqMessageStore;
    private final KafkaTemplate<String, String> stringKafkaTemplate;

    public DlqAdminService(DlqMessageStore dlqMessageStore,
            @Qualifier("stringKafkaTemplate") KafkaTemplate<String, String> stringKafkaTemplate) {
        this.dlqMessageStore = dlqMessageStore;
        this.stringKafkaTemplate = stringKafkaTemplate;
    }

    public List<DlqMessageView> list() {
        return dlqMessageStore.findAll();
    }

    public DlqMessageView replay(String id) {
        DlqMessageView message = dlqMessageStore.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "DLQ message not found: " + id));
        if (message.originalTopic() == null || message.originalTopic().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DLQ message has no original topic");
        }
        stringKafkaTemplate.send(new ProducerRecord<>(message.originalTopic(), null, message.payload()));
        return dlqMessageStore.markReplayed(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to mark replayed"));
    }
}
