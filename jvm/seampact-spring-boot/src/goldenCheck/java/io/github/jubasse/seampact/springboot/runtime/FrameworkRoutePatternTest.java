package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * The `frameworkRoutes` patterns as the boot check matches them, the rule every server target shares: `*` one segment,
 * `**` any number, a `*` inside a segment any characters but `/`, an empty segment dropped on both sides, and a
 * catch-all route (`{*rest}`, `**`) taken only by `**`.
 */
class FrameworkRoutePatternTest {
    private void assertMatch(boolean expected, String allowed, String routePattern) {
        assertEquals(expected, FrameworkRoutePattern.allows(allowed, routePattern), allowed + " against " + routePattern);
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
        assertMatch(false, "/up.json", "/upxjson");
    }

    @Test
    void aWholeStarSegmentAndTwoStarsKeepTheirMeaning() {
        assertMatch(true, "/admin/*", "/admin/queues");
        assertMatch(true, "/orders/*", "/orders/{id}");
        assertMatch(false, "/admin/*", "/admin/queues/jobs");
        assertMatch(true, "/actuator/**", "/actuator");
        assertMatch(true, "/actuator/**", "/actuator/health/db");
        assertMatch(false, "/actuator/**", "/actuatorX");
        assertMatch(true, "/a/**/z", "/a/z");
        assertMatch(true, "/a/**/b/**/c", "/a/x/b/y/z/c");
        assertMatch(false, "/a/**/b/**/c", "/a/c/b");
        assertMatch(false, "/**/*", "/");
    }

    @Test
    void anEmptySegmentIsDroppedOnBothSides() {
        assertMatch(true, "/a", "/a/");
        assertMatch(true, "/a/**", "/a/");
        assertMatch(false, "/a/*", "/a/");
        assertMatch(true, "/a/b", "/a//b");
        assertMatch(false, "/a/*/b", "/a//b");
        assertMatch(true, "/", "/");
        assertMatch(true, "/**", "/");
        assertMatch(false, "/*", "/");
    }

    @Test
    void aCatchAllRouteIsTakenOnlyByTwoStars() {
        assertMatch(false, "/files/*", "/files/{*rest}");
        assertMatch(false, "/files/*", "/files/**");
        assertMatch(false, "/*", "/{*rest}");
        assertMatch(true, "/files/**", "/files/{*rest}");
        assertMatch(true, "/files/**", "/files/**");
        assertMatch(true, "/**", "/{*rest}");
    }

    @Test
    void theDefaultScopeChecksOnlyARouteThatCanServeAPathUnderABasePath() {
        List<String> basePaths = List.of("/api/v1");

        assertTrue(FrameworkRoutePattern.overlapsAny(basePaths, "/api/v1"));
        assertTrue(FrameworkRoutePattern.overlapsAny(basePaths, "/api/v1/docs"));
        assertTrue(FrameworkRoutePattern.overlapsAny(basePaths, "/{page}/v1/x"));
        assertTrue(FrameworkRoutePattern.overlapsAny(basePaths, "/**"));
        assertTrue(FrameworkRoutePattern.overlapsAny(basePaths, "/{*rest}"));
        assertFalse(FrameworkRoutePattern.overlapsAny(basePaths, "/health"));
        assertFalse(FrameworkRoutePattern.overlapsAny(basePaths, "/api"));
        assertFalse(FrameworkRoutePattern.overlapsAny(basePaths, "/{page}"));
        assertTrue(FrameworkRoutePattern.overlapsAny(List.of(""), "/health"));
    }

    @Test
    void aSegmentWithAWildcardOrAVariableTakesTheBasePathSegment() {
        List<String> basePaths = List.of("/api/v1");

        assertTrue(FrameworkRoutePattern.overlapsAny(basePaths, "/ap*/**"));
        assertTrue(FrameworkRoutePattern.overlapsAny(basePaths, "/api/v?/tasks"));
        assertTrue(FrameworkRoutePattern.overlapsAny(basePaths, "/api/v{version}/tasks"));
        assertFalse(FrameworkRoutePattern.overlapsAny(basePaths, "/ap*"));
    }

    @Test
    void aLiteralInAnotherCaseTakesTheBasePathSegment() {
        assertTrue(FrameworkRoutePattern.overlapsAny(List.of("/api/v1"), "/API/v1/tasks"));
    }
}
