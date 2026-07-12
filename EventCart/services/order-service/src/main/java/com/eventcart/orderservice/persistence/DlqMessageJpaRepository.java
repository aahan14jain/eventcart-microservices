package com.eventcart.orderservice.persistence;

import org.springframework.context.annotation.Profile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

@Profile("postgres")
public interface DlqMessageJpaRepository extends JpaRepository<DlqMessageEntity, String> {

    List<DlqMessageEntity> findAllByOrderByReceivedAtDesc();
}
