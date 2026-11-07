package com.example.consumer;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** The framework route outside the contract the boot variants that check that route serve. */
@RestController
@ServedUnder({
    "unlisted-framework-route",
    "allow-listed-framework-route",
    "framework-route-check-off",
    "hook-check-off-unlisted-route"
})
class UnlistedRouteController {
    @GetMapping("/v1/unlisted")
    Map<String, String> unlisted() {
        return Map.of("route", "unlisted");
    }
}
