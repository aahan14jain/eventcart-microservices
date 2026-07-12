package com.eventcart.orderservice;

import com.eventcart.orderservice.admin.SagaAdminService;
import com.eventcart.orderservice.cache.RedisOrderCacheService;
import com.eventcart.orderservice.events.OrderCreatedEvent;
import com.eventcart.orderservice.messaging.OrderEventPublisher;
import com.eventcart.orderservice.metrics.SagaMetrics;
import com.eventcart.orderservice.observability.CorrelationId;
import com.eventcart.orderservice.observability.CorrelationIdFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class OrderControllerCorrelationTest {

    @Mock
    private OrderStore orderStore;

    @Mock
    private OrderEventPublisher orderEventPublisher;

    @Mock
    private RedisOrderCacheService redisOrderCacheService;

    @Mock
    private SagaMetrics sagaMetrics;

    @Mock
    private SagaAdminService sagaAdminService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        OrderController controller = new OrderController(orderStore, orderEventPublisher, redisOrderCacheService,
                sagaMetrics, sagaAdminService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .addFilters(new CorrelationIdFilter())
                .build();
    }

    @Test
    void createOrderResponseHeaderMatchesEventCorrelationIdFromFilter() throws Exception {
        var result = mockMvc.perform(post("/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[],\"totalAmount\":0}"))
                .andExpect(status().isOk())
                .andExpect(header().exists(CorrelationId.HEADER_NAME))
                .andReturn();

        String headerValue = result.getResponse().getHeader(CorrelationId.HEADER_NAME);
        assertThat(headerValue).isNotNull();

        ArgumentCaptor<OrderCreatedEvent> captor = ArgumentCaptor.forClass(OrderCreatedEvent.class);
        verify(orderEventPublisher).publishOrderCreated(captor.capture());
        assertThat(captor.getValue().getCorrelationId()).isEqualTo(headerValue);
    }

    @Test
    void createOrderEchoesClientCorrelationIdOnEventAndHeader() throws Exception {
        var result = mockMvc.perform(post("/orders")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(CorrelationId.HEADER_NAME, "client-corr-xyz")
                        .content("{\"items\":[],\"totalAmount\":0}"))
                .andExpect(status().isOk())
                .andExpect(header().string(CorrelationId.HEADER_NAME, "client-corr-xyz"))
                .andReturn();

        ArgumentCaptor<OrderCreatedEvent> captor = ArgumentCaptor.forClass(OrderCreatedEvent.class);
        verify(orderEventPublisher).publishOrderCreated(captor.capture());
        assertThat(captor.getValue().getCorrelationId()).isEqualTo("client-corr-xyz");
        assertThat(captor.getValue().getCorrelationId()).isEqualTo(result.getResponse().getHeader(CorrelationId.HEADER_NAME));
    }
}
