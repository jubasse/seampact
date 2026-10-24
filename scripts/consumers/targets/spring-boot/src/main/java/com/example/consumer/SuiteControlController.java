package com.example.consumer;

import java.util.Map;
import java.util.Optional;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** The suite's control routes, framework routes outside the contract that the config allow-lists. */
@RestController
@RequestMapping("/__seampact")
class SuiteControlController {
    @PutMapping("/script")
    ResponseEntity<Map<String, String>> loadScript(@RequestBody JsonNode body) {
        Optional<String> problem = SuiteControl.load(body);

        return problem.map(message -> ResponseEntity.badRequest().body(Map.of("message", message)))
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @GetMapping("/hook-calls")
    Map<String, Object> hookCalls() {
        return Map.of("calls", SuiteControl.hookCalls());
    }

    @GetMapping("/log-lines")
    Map<String, Object> logLines() {
        return Map.of("lines", SuiteControl.logLines());
    }
}
