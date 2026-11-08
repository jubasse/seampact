package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The `frameworkRoutes` rule every server target shares (ADR 0011 "The app config"), on Spring's route patterns. */
class FrameworkRoutePatternTest {
    @Test
    void aLiteralPathAllowsItselfWhateverItsEmptySegments() {
        assertTrue(FrameworkRoutePattern.allows("/health", "/health"));
        assertTrue(FrameworkRoutePattern.allows("/health/", "/health"));
        assertTrue(FrameworkRoutePattern.allows("//health", "/health//"));
        assertFalse(FrameworkRoutePattern.allows("/health", "/healthz"));
        assertFalse(FrameworkRoutePattern.allows("/health", "/health/live"));
    }

    @Test
    void aStarIsExactlyOneSegment() {
        assertTrue(FrameworkRoutePattern.allows("/actuator/*", "/actuator/health"));
        assertFalse(FrameworkRoutePattern.allows("/actuator/*", "/actuator"));
        assertFalse(FrameworkRoutePattern.allows("/actuator/*", "/actuator/health/live"));
    }

    @Test
    void aDoubleStarIsAnyNumberOfSegmentsNoneIncluded() {
        assertTrue(FrameworkRoutePattern.allows("/actuator/**", "/actuator"));
        assertTrue(FrameworkRoutePattern.allows("/actuator/**", "/actuator/a/b/c"));
        assertTrue(FrameworkRoutePattern.allows("/a/**/z", "/a/z"));
        assertTrue(FrameworkRoutePattern.allows("/a/**/z", "/a/b/c/z"));
        assertFalse(FrameworkRoutePattern.allows("/a/**/z", "/a/b"));
        assertFalse(FrameworkRoutePattern.allows("/actuator/**", "/other"));
    }

    @Test
    void aStarInsideASegmentTakesAnyCharactersButASlash() {
        assertTrue(FrameworkRoutePattern.allows("/files/*.json", "/files/x.json"));
        assertTrue(FrameworkRoutePattern.allows("/files/*.json", "/files/.json"));
        assertFalse(FrameworkRoutePattern.allows("/files/*.json", "/files/x.yaml"));
        assertFalse(FrameworkRoutePattern.allows("/files/*.json", "/files/a/x.json"));
        assertTrue(FrameworkRoutePattern.allows("/v*/x", "/v1/x"));
    }

    @Test
    void literalPartsBetweenStarsAppearInOrderAndDoNotOverlapTheEnds() {
        assertTrue(FrameworkRoutePattern.allows("/s/a*b*c", "/s/a1b2c"));
        assertTrue(FrameworkRoutePattern.allows("/s/a*b*c", "/s/abc"));
        assertFalse(FrameworkRoutePattern.allows("/s/a*b*c", "/s/ac"));
        assertFalse(FrameworkRoutePattern.allows("/s/a*b*c", "/s/acb"));
        assertFalse(FrameworkRoutePattern.allows("/s/ab*ba", "/s/aba"));
        assertTrue(FrameworkRoutePattern.allows("/s/a*b*b*c", "/s/abbc"));
        assertFalse(FrameworkRoutePattern.allows("/s/a*b*b*c", "/s/abc"));
    }

    @Test
    void aCatchAllRouteSegmentIsTakenOnlyByADoubleStar() {
        assertTrue(FrameworkRoutePattern.allows("/docs/**", "/docs/{*rest}"));
        assertTrue(FrameworkRoutePattern.allows("/**", "/**"));
        assertFalse(FrameworkRoutePattern.allows("/docs/*", "/docs/{*rest}"));
        assertFalse(FrameworkRoutePattern.allows("/docs/page", "/docs/{*rest}"));
        assertFalse(FrameworkRoutePattern.allows("/*", "/**"));
    }

    @Test
    void aOneSegmentVariableOfTheRouteIsTakenByAStarOrItsOwnText() {
        assertTrue(FrameworkRoutePattern.allows("/users/*", "/users/{id}"));
        assertTrue(FrameworkRoutePattern.allows("/users/{id}", "/users/{id}"));
        assertFalse(FrameworkRoutePattern.allows("/users/x", "/users/{id}"));
    }

    @Test
    void manyDoubleStarsAnswerWithoutBacktracking() {
        String pattern = "/**/**/**/**/**/**/**/**/**/**/**/**/x";
        String route = "/" + String.join("/", java.util.Collections.nCopies(60, "a"));

        assertFalse(assertTimeoutPreemptively(Duration.ofSeconds(5), () -> FrameworkRoutePattern.allows(pattern, route)));
        assertTrue(FrameworkRoutePattern.allows(pattern, route + "/x"));
    }

    @Test
    void aRouteOverlapsABasePathItServesAtOrUnder() {
        List<String> bases = List.of("/api/v1");

        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/api/v1"));
        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/api/v1/tasks"));
        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/API/V1/x"));
        assertFalse(FrameworkRoutePattern.overlapsAny(bases, "/other/x"));
        assertFalse(FrameworkRoutePattern.overlapsAny(bases, "/api/v2/x"));
        assertFalse(FrameworkRoutePattern.overlapsAny(bases, "/api"));
    }

    @Test
    void aVariableWildcardOrCatchAllSegmentMayServeTheBasePath() {
        List<String> bases = List.of("/api/v1");

        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/{tenant}/v1"));
        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/api/{version}/x"));
        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/api/v{n}"));
        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/a*/v1"));
        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/api/v?"));
        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/**"));
        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/api/{*rest}"));
        assertTrue(FrameworkRoutePattern.overlapsAny(bases, "/api/{id:[0-9]{2/x}"));
    }

    @Test
    void anyOfSeveralBasePathsOrAnEmptyOneIsEnough() {
        assertTrue(FrameworkRoutePattern.overlapsAny(List.of("/a", "/b"), "/b/x"));
        assertFalse(FrameworkRoutePattern.overlapsAny(List.of("/a", "/b"), "/c/x"));
        assertTrue(FrameworkRoutePattern.overlapsAny(List.of(""), "/anything"));
        assertFalse(FrameworkRoutePattern.overlapsAny(List.of(), "/anything"));
    }
}
