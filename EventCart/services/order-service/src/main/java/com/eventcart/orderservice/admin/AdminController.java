package com.eventcart.orderservice.admin;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/admin")
public class AdminController {

    private final SagaAdminService sagaAdminService;
    private final DlqAdminService dlqAdminService;

    public AdminController(SagaAdminService sagaAdminService, DlqAdminService dlqAdminService) {
        this.sagaAdminService = sagaAdminService;
        this.dlqAdminService = dlqAdminService;
    }

    @GetMapping("/sagas")
    public List<SagaInstanceView> listSagas(@RequestParam(defaultValue = "50") int limit) {
        return sagaAdminService.listRecent(Math.min(Math.max(limit, 1), 200));
    }

    @GetMapping("/dlq")
    public List<DlqMessageView> listDlq() {
        return dlqAdminService.list();
    }

    @PostMapping("/dlq/{id}/replay")
    public DlqMessageView replayDlq(@PathVariable String id) {
        return dlqAdminService.replay(id);
    }
}
