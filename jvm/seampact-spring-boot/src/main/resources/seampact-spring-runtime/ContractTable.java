package io.github.jubasse.seampact.springboot.runtime;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/**
 * The api's contract as the boundary reads it: the IR view the generator wrote (the kept operations and the
 * declarations they read) and the entry's settings, with the routes built once.
 */
public final class ContractTable {
    private static final String HEAD = "HEAD";
    private static final String GET = "GET";
    private static final String PATH_PARAMETER_START = ";";
    private static final String CURRENT_SEGMENT = ".";
    private static final String PARENT_SEGMENT = "..";

    static final String NOT_FOUND_ROLE = "notFound";

    private final JsonNode ir;
    private final List<ContractRoute> routes;
    private final List<String> basePaths;

    ContractTable(JsonNode ir) {
        this.ir = ir;

        List<ContractRoute> built = new ArrayList<>();
        Set<String> prefixes = new LinkedHashSet<>();
        for (JsonNode operation : ir.path("operations")) {
            String prefix = ir.path("api").path("surfaces").path(operation.path("surface").asString()).path("prefix").asString("");
            built.add(new ContractRoute(operation, ir.path("errors"), prefix));
            prefixes.add(prefix);
        }

        built.sort(ContractRoute.MOST_SPECIFIC_FIRST);
        this.routes = List.copyOf(built);
        this.basePaths = List.copyOf(prefixes);
    }

    public String apiId() {
        return ir.path("api").path("id").asString();
    }

    public List<ContractRoute> routes() {
        return routes;
    }

    JsonNode ir() {
        return ir;
    }

    /** The entry's settings the generator wrote beside the IR view: `responses`, `catchAll`, the boot check. */
    JsonNode settings() {
        return ir.path("settings");
    }

    JsonNode schema(String schemaId) {
        return ir.path("schemas").path(schemaId);
    }

    JsonNode enumeration(String enumId) {
        return ir.path("enums").path(enumId);
    }

    JsonNode format(ContractRoute route) {
        return ir.path("formats").path(route.operation().path("format").asString());
    }

    /**
     * Whether the raw [rawPath] is one of the api's base paths or below one, read as Spring routes it: each segment
     * without its `;` parameters and percent-decoded, dot segments resolved. The route match itself stays raw.
     */
    boolean isUnderBasePath(String rawPath) {
        String path = routedPath(rawPath);

        return basePaths.stream().anyMatch(base -> !base.isEmpty() && (path.equals(base) || path.startsWith(base + "/")));
    }

    private static String routedPath(String rawPath) {
        Deque<String> segments = new ArrayDeque<>();

        for (String rawSegment : rawPath.split("/", -1)) {
            int parameters = rawSegment.indexOf(PATH_PARAMETER_START);
            String segment = ContractRoute.decodedSegment(parameters < 0 ? rawSegment : rawSegment.substring(0, parameters));

            if (segment.equals(CURRENT_SEGMENT)) continue;
            if (segment.equals(PARENT_SEGMENT)) {
                if (segments.size() > 1) segments.removeLast();
                continue;
            }
            segments.addLast(segment);
        }

        return String.join("/", segments);
    }

    /** The most specific route [method] and [path] reach; `HEAD` reaches the path's `GET` operation. */
    Optional<RouteMatch> match(String method, String path) {
        String served = HEAD.equals(method) ? GET : method;

        for (ContractRoute route : routes) {
            if (!route.method().equals(served)) continue;
            Optional<Map<String, String>> params = route.match(path);
            if (params.isPresent()) return Optional.of(new RouteMatch(route, params.get()));
        }

        return Optional.empty();
    }

    /** The route whose `notFound` reply answers a request to [path] that no route serves with its method. */
    Optional<ContractRoute> notFoundRoute(String path) {
        for (ContractRoute route : routes) {
            if (route.match(path).isPresent() && route.codeOfRole(NOT_FOUND_ROLE).isPresent()) return Optional.of(route);
        }

        return routes.stream().filter(route -> route.codeOfRole(NOT_FOUND_ROLE).isPresent()).findFirst();
    }

    /** A route and the decoded path parameters a request matched it with. */
    record RouteMatch(ContractRoute route, Map<String, String> pathParams) {}
}
