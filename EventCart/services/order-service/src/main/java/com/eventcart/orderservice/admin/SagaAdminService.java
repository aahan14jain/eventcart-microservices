package com.eventcart.orderservice.admin;

import com.eventcart.orderservice.OrderStatus;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;

@Service
public class SagaAdminService {

    private final SagaStateStore sagaStateStore;

    public SagaAdminService(SagaStateStore sagaStateStore) {
        this.sagaStateStore = sagaStateStore;
    }

    public void recordOrderCreated(String orderId) {
        sagaStateStore.recordStep(orderId, OrderStatus.PENDING, SagaStepName.ORDER, "order.created",
                SagaStepOutcome.SUCCESS);
    }

    public void recordSagaEvent(String orderId, OrderStatus status, String eventType) {
        SagaStepName step = mapStep(eventType);
        SagaStepOutcome outcome = status == OrderStatus.FAILED ? SagaStepOutcome.FAILURE : SagaStepOutcome.SUCCESS;
        sagaStateStore.recordStep(orderId, status, step, eventType, outcome);
    }

    public List<SagaInstanceView> listRecent(int limit) {
        return sagaStateStore.findRecent(limit);
    }

    static SagaStepName mapStep(String eventType) {
        String t = eventType == null ? "" : eventType.toLowerCase(Locale.ROOT);
        if (t.startsWith("inventory.")) {
            return SagaStepName.INVENTORY;
        }
        if (t.startsWith("payment.")) {
            return SagaStepName.PAYMENT;
        }
        return SagaStepName.ORDER;
    }
}
