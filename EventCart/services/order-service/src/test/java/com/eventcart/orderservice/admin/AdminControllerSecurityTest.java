package com.eventcart.orderservice.admin;

import com.eventcart.orderservice.config.AdminSecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.kafka.test.context.EmbeddedKafka;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@EmbeddedKafka(partitions = 1, topics = {
        "inventory.reserved.DLT",
        "inventory.failed.DLT",
        "payment.succeeded.DLT",
        "payment.failed.DLT"
})
@TestPropertySource(properties = {
        "spring.kafka.bootstrap-servers=${spring.embedded.kafka.brokers}",
        "spring.data.redis.host=localhost",
        "spring.data.redis.port=6370",
        "admin.security.username=admin",
        "admin.security.password=secret",
        "admin.security.api-key=test-admin-key",
        "spring.kafka.listener.auto-startup=false"
})
class AdminControllerSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DlqMessageStore dlqMessageStore;

    @Autowired
    private SagaAdminService sagaAdminService;

    @Test
    void adminEndpointsRequireAuth() throws Exception {
        mockMvc.perform(get("/admin/sagas")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/admin/dlq")).andExpect(status().isUnauthorized());
    }

    @Test
    void adminBasicAuthCanListSagas() throws Exception {
        sagaAdminService.recordOrderCreated("order-admin-1");

        mockMvc.perform(get("/admin/sagas").with(httpBasic("admin", "secret")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].orderId").value("order-admin-1"))
                .andExpect(jsonPath("$[0].steps[0].step").value("ORDER"));
    }

    @Test
    void adminApiKeyCanListAndReplayDlq() throws Exception {
        DlqMessageView saved = dlqMessageStore.save(
                "inventory.reserved.DLT", 0, 1L, "inventory.reserved", "{\"orderId\":\"o1\"}");

        mockMvc.perform(get("/admin/dlq").header(AdminSecurityConfig.API_KEY_HEADER, "test-admin-key"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(saved.id()))
                .andExpect(jsonPath("$[0].originalTopic").value("inventory.reserved"));

        mockMvc.perform(post("/admin/dlq/{id}/replay", saved.id())
                        .header(AdminSecurityConfig.API_KEY_HEADER, "test-admin-key")
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.replayed").value(true));
    }

    @Test
    void customerOrdersRemainPublic() throws Exception {
        mockMvc.perform(get("/orders/hello")).andExpect(status().isOk());
    }
}
