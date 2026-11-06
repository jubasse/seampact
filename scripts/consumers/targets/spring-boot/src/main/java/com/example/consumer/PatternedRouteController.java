package com.example.consumer;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** The framework route the `pattern-allow-listed-framework-route` boot variant serves, allow-listed by a pattern. */
@RestController
@ServedUnder("pattern-allow-listed-framework-route")
class PatternedRouteController {
    @GetMapping("/v1/patterned/one/two")
    Map<String, String> patterned() {
        return Map.of("route", "patterned");
    }
}
