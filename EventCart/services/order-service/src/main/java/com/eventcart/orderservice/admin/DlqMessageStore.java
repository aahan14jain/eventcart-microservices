package com.eventcart.orderservice.admin;

import java.util.List;
import java.util.Optional;

public interface DlqMessageStore {

    DlqMessageView save(String topic, int partition, long offset, String originalTopic, String payload);

    List<DlqMessageView> findAll();

    Optional<DlqMessageView> findById(String id);

    Optional<DlqMessageView> markReplayed(String id);
}
