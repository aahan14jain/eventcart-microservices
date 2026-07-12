package com.eventcart.orderservice.admin;

import com.eventcart.orderservice.persistence.DlqMessageEntity;
import com.eventcart.orderservice.persistence.DlqMessageJpaRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
@Profile("postgres")
public class PostgresDlqMessageStore implements DlqMessageStore {

    private final DlqMessageJpaRepository repository;

    public PostgresDlqMessageStore(DlqMessageJpaRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    public DlqMessageView save(String topic, int partition, long offset, String originalTopic, String payload) {
        DlqMessageEntity entity = new DlqMessageEntity(
                UUID.randomUUID().toString(), topic, partition, offset, originalTopic, payload);
        return toView(repository.save(entity));
    }

    @Override
    @Transactional(readOnly = true)
    public List<DlqMessageView> findAll() {
        return repository.findAllByOrderByReceivedAtDesc().stream().map(this::toView).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<DlqMessageView> findById(String id) {
        return repository.findById(id).map(this::toView);
    }

    @Override
    @Transactional
    public Optional<DlqMessageView> markReplayed(String id) {
        return repository.findById(id).map(entity -> {
            entity.setReplayed(true);
            return toView(repository.save(entity));
        });
    }

    private DlqMessageView toView(DlqMessageEntity entity) {
        return new DlqMessageView(
                entity.getId(),
                entity.getTopic(),
                entity.getPartition(),
                entity.getOffset(),
                entity.getOriginalTopic(),
                entity.getPayload(),
                entity.getReceivedAt(),
                entity.isReplayed());
    }
}
