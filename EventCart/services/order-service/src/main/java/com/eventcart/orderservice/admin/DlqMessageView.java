package com.eventcart.orderservice.admin;

import java.time.Instant;

public record DlqMessageView(
        String id,
        String topic,
        int partition,
        long offset,
        String originalTopic,
        String payload,
        Instant receivedAt,
        boolean replayed
) {
}
