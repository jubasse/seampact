package com.example.consumer;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** The framework route outside the contract the two framework-route boot variants serve. */
@RestController
@ServedUnder({"unlisted-framework-route", "allow-listed-framework-route"})
class UnlistedRouteController {
    @GetMapping("/v1/unlisted")
    Map<String, String> unlisted() {
        return Map.of("route", "unlisted");
    }
}
