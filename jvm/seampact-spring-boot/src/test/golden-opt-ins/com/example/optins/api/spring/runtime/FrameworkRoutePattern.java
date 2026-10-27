package com.example.optins.api.spring.runtime;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * A `frameworkRoutes` path pattern against a route pattern Spring lists, the rule every server target shares (ADR 0011
 * "The app config"): `*` one segment, `**` any number, a `*` inside a segment any characters but `/`, an empty segment
 * dropped on both sides, and a catch-all route segment (`{*rest}`, `**`) taken only by `**`.
 */
final class FrameworkRoutePattern {
    private static final String ONE_SEGMENT = "*";
    private static final String ANY_SEGMENTS = "**";
    private static final String CAPTURE_ALL_START = "{*";
    private static final String VARIABLE_START = "{";
    // No allowance segment can be empty, so this token never equals one.
    private static final String CATCH_ALL_SEGMENT = "";

    private FrameworkRoutePattern() {}

    static boolean allows(String allowedPath, String routePattern) {
        return segmentsMatch(segmentsOf(allowedPath), routeSegmentsOf(routePattern));
    }

    // One step per pattern segment: `ends[index]` says the pattern so far can end before route segment `index`, so
    // pattern times route steps, never a backtrack, however many `**` the pattern has.
    private static boolean segmentsMatch(List<String> pattern, List<String> route) {
        boolean[] ends = new boolean[route.size() + 1];
        ends[0] = true;

        for (String patternSegment : pattern) {
            ends = ANY_SEGMENTS.equals(patternSegment)
                    ? endsAfterAnySegments(ends)
                    : endsAfterOneSegment(ends, patternSegment, route);
        }

        return ends[route.size()];
    }

    private static boolean[] endsAfterAnySegments(boolean[] ends) {
        boolean[] next = new boolean[ends.length];
        boolean reached = false;

        for (int index = 0; index < ends.length; index++) {
            reached |= ends[index];
            next[index] = reached;
        }

        return next;
    }

    // A catch-all segment of a route serves any number of segments, so only `**` matches it, never `*` or a literal.
    private static boolean[] endsAfterOneSegment(boolean[] ends, String patternSegment, List<String> route) {
        boolean[] next = new boolean[ends.length];

        for (int index = 1; index < ends.length; index++) {
            String segment = route.get(index - 1);
            next[index] = ends[index - 1]
                    && !segment.equals(CATCH_ALL_SEGMENT)
                    && segmentMatches(patternSegment, segment);
        }

        return next;
    }

    // A `*` inside a pattern segment takes any characters, none included; the rest of the segment is literal.
    private static boolean segmentMatches(String patternSegment, String segment) {
        if (ONE_SEGMENT.equals(patternSegment)) return true;

        String[] parts = patternSegment.split("\\*", -1);
        if (parts.length == 1) return patternSegment.equals(segment);

        String prefix = parts[0];
        String suffix = parts[parts.length - 1];
        if (segment.length() < prefix.length() + suffix.length()) return false;
        if (!segment.startsWith(prefix) || !segment.endsWith(suffix)) return false;

        List<String> middles = Arrays.asList(parts).subList(1, parts.length - 1);

        return middlesFollow(middles, segment.substring(prefix.length(), segment.length() - suffix.length()));
    }

    // The literal parts between stars appear in order; taking each at its first place leaves the most room for the
    // next.
    private static boolean middlesFollow(List<String> middles, String text) {
        int searchFrom = 0;

        for (String middle : middles) {
            int found = text.indexOf(middle, searchFrom);
            if (found == -1) return false;

            searchFrom = found + middle.length();
        }

        return true;
    }

    private static List<String> segmentsOf(String path) {
        List<String> segments = new ArrayList<>();

        for (String segment : path.split("/")) {
            if (!segment.isEmpty()) segments.add(segment);
        }

        return segments;
    }

    /**
     * Whether a route pattern can serve a path at or under one of [basePaths]: each of its first segments takes the
     * base path's (the same text, a variable, `*` or a catch-all), and it has as many segments, or a catch-all.
     */
    static boolean overlapsAny(List<String> basePaths, String routePattern) {
        List<String> route = routeSegmentsOf(routePattern);

        return basePaths.stream().anyMatch(basePath -> overlaps(route, segmentsOf(basePath)));
    }

    private static boolean overlaps(List<String> route, List<String> base) {
        for (int index = 0; index < base.size(); index++) {
            if (index >= route.size()) return false;

            String segment = route.get(index);
            if (segment.equals(CATCH_ALL_SEGMENT)) return true;
            if (!isVariable(segment) && !segment.equals(base.get(index))) return false;
        }

        return true;
    }

    private static boolean isVariable(String segment) {
        return segment.equals(ONE_SEGMENT) || segment.contains(VARIABLE_START);
    }

    // Spring writes a catch-all as `**` or `{*name}`; a one-segment variable (`{id}`) or wildcard (`*`) stays one
    // segment.
    private static List<String> routeSegmentsOf(String routePattern) {
        List<String> segments = segmentsOf(routePattern);
        segments.replaceAll(segment -> isCatchAll(segment) ? CATCH_ALL_SEGMENT : segment);

        return segments;
    }

    private static boolean isCatchAll(String segment) {
        return segment.equals(ANY_SEGMENTS) || segment.startsWith(CAPTURE_ALL_START);
    }
}
