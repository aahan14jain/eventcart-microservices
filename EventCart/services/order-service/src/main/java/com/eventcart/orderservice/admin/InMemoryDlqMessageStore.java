package com.eventcart.orderservice.admin;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
@Profile("!postgres")
public class InMemoryDlqMessageStore implements DlqMessageStore {

    private final Map<String, DlqMessageView> byId = new ConcurrentHashMap<>();

    @Override
    public DlqMessageView save(String topic, int partition, long offset, String originalTopic, String payload) {
        String id = UUID.randomUUID().toString();
        DlqMessageView view = new DlqMessageView(id, topic, partition, offset, originalTopic, payload, Instant.now(),
                false);
        byId.put(id, view);
        return view;
    }

    @Override
    public List<DlqMessageView> findAll() {
        List<DlqMessageView> list = new ArrayList<>(byId.values());
        list.sort(Comparator.comparing(DlqMessageView::receivedAt).reversed());
        return list;
    }

    @Override
    public Optional<DlqMessageView> findById(String id) {
        return Optional.ofNullable(byId.get(id));
    }

    @Override
    public Optional<DlqMessageView> markReplayed(String id) {
        return Optional.ofNullable(byId.computeIfPresent(id, (k, v) -> new DlqMessageView(
                v.id(), v.topic(), v.partition(), v.offset(), v.originalTopic(), v.payload(), v.receivedAt(), true)));
    }
}
