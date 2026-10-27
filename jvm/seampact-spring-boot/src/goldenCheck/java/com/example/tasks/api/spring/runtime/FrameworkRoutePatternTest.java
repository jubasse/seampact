package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.springframework.util.AntPathMatcher;

/**
 * The `frameworkRoutes` patterns as the boot check matches them, with Spring's AntPathMatcher: `*` one segment, `**`
 * any number, and a `*` inside a segment any characters but `/`, the meaning every server target shares.
 */
class FrameworkRoutePatternTest {
    private final AntPathMatcher paths = new AntPathMatcher();

    private void assertMatch(boolean expected, String allowed, String routePattern) {
        assertEquals(expected, paths.match(allowed, routePattern), allowed + " against " + routePattern);
    }

    @Test
    void aStarInsideASegmentTakesAnyCharactersButASlash() {
        assertMatch(true, "/livewire-*/**", "/livewire-3f9a/upload-file");
        assertMatch(true, "/livewire*/**", "/livewire/update");
        assertMatch(true, "/files-*", "/files-{id}");
        assertMatch(true, "/*.json", "/up.json");
        assertMatch(false, "/livewire-*/**", "/live-3f9a/upload-file");
        assertMatch(false, "/livewire-*", "/livewire-3f9a/upload-file");
        assertMatch(false, "/*.json", "/up.xml");
    }

    @Test
    void aWholeStarSegmentAndTwoStarsKeepTheirMeaning() {
        assertMatch(true, "/admin/*", "/admin/queues");
        assertMatch(false, "/admin/*", "/admin/queues/jobs");
        assertMatch(true, "/actuator/**", "/actuator");
        assertMatch(true, "/actuator/**", "/actuator/health/db");
        assertMatch(false, "/actuator/**", "/actuatorX");
    }
}
