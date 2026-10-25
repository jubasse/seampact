package com.example.tasks.api.spring.runtime;

import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.hooks.Purpose;
import io.github.jubasse.seampact.hooks.RequestView;
import io.github.jubasse.seampact.hooks.RequirementKind;
import io.github.jubasse.seampact.hooks.RequirementRequest;
import io.github.jubasse.seampact.hooks.ResolveScopeRequest;
import io.github.jubasse.seampact.hooks.ResolvedScope;
import io.github.jubasse.seampact.hooks.ScopeIdSource;
import io.github.jubasse.seampact.hooks.ScopeResolution;
import io.github.jubasse.seampact.hooks.SubjectRef;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.MissingNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Steps 2 to 5 of the check order (ADR 0012 "The check order"): authenticate with the identity's hook bean (and the
 * CSRF header a cookie credential needs), resolve the scopes, then ask the deciders for each requirement in declared
 * order. Each refusal is one of the codes the hook's declaration lists.
 */
final class AccessSteps {
    private static final String BEARER_PREFIX = "bearer ";
    private static final String UNAUTHENTICATED_ROLE = "unauthenticated";
    private static final String CSRF_INVALID_ROLE = "csrfInvalid";
    private static final String ACCESS_DENIED = "org.springframework.security.access.AccessDeniedException";
    private static final String OPTIONAL_ACCESS = "optional";
    private static final String ANONYMOUS = "anonymous";

    private AccessSteps() {}

    static void run(SeampactBoundary boundary, BoundaryExchange exchange, HttpServletRequest request) {
        RequestView view = boundary.requestView(request, exchange);
        authenticate(boundary, exchange, request, view);
        resolveScopes(boundary, exchange);
        decideRequirements(boundary, exchange, view);
    }

    private static void authenticate(SeampactBoundary boundary, BoundaryExchange exchange, HttpServletRequest request, RequestView view) {
        ContractRoute route = exchange.route();
        JsonNode access = route.operation().path("access");
        if (!access.has("identity")) return;

        boolean optional = OPTIONAL_ACCESS.equals(access.path("kind").asString());
        ObjectNode credentials = JsonNodeFactory.instance.objectNode();
        boolean onlyCookies = readCredentials(boundary, access, request, credentials);
        if (credentials.isEmpty()) {
            if (optional) return;
            throw new ContractRefusal(BoundaryFilter.roleCode(route, UNAUTHENTICATED_ROLE), MissingNode.getInstance());
        }

        Optional<String> csrfToken = Optional.empty();
        JsonNode csrf = route.operation().path("csrf");
        if (csrf.has("header")) {
            csrfToken = Optional.ofNullable(request.getHeader(csrf.path("header").asString()));
            if (onlyCookies && csrfToken.isEmpty()) {
                throw new ContractRefusal(BoundaryFilter.roleCode(route, CSRF_INVALID_ROLE), MissingNode.getInstance());
            }
        }

        AuthenticateResult<?, Denial> result = boundary.binding().authenticate(access.path("identity").asString(), boundary.beans(),
                boundary.mapper(), credentials, csrfToken, view, boundary.operationRef(route));

        switch (result) {
            case AuthenticateResult.Authenticated<?, Denial> authenticated -> exchange.principal = authenticated.principal();
            case AuthenticateResult.Denied<?, Denial> denied -> {
                if (optional && ANONYMOUS.equals(access.path("onRefused").asString())) return;
                throw refusalOf(boundary, denied.deny());
            }
        }
    }

    // Each scheme the operation reads, by its id; true when every credential found is a cookie.
    private static boolean readCredentials(SeampactBoundary boundary, JsonNode access, HttpServletRequest request, ObjectNode credentials) {
        boolean onlyCookies = true;

        for (JsonNode schemeId : access.path("schemes")) {
            JsonNode scheme = boundary.table().ir().path("schemes").path(schemeId.asString());
            Optional<String> value = switch (scheme.path("kind").asString()) {
                case "bearer" -> bearerToken(request);
                case "cookie" -> cookie(request, scheme.path("name").asString());
                case "header" -> Optional.ofNullable(request.getHeader(scheme.path("name").asString()));
                default -> throw new IllegalStateException("seampact: the credential scheme kind '" + scheme.path("kind").asString() + "' is not one the boundary reads");
            };

            if (value.isEmpty()) continue;
            credentials.put(schemeId.asString(), value.get());
            if (!"cookie".equals(scheme.path("kind").asString())) onlyCookies = false;
        }

        return onlyCookies;
    }

    private static Optional<String> bearerToken(HttpServletRequest request) {
        String authorization = request.getHeader("Authorization");
        if (authorization == null || !authorization.toLowerCase(Locale.ROOT).startsWith(BEARER_PREFIX)) return Optional.empty();

        String token = authorization.substring(BEARER_PREFIX.length()).trim();

        return token.isEmpty() ? Optional.empty() : Optional.of(token);
    }

    private static Optional<String> cookie(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return Optional.empty();

        for (Cookie cookie : cookies) {
            if (cookie.getName().equals(name)) return Optional.of(cookie.getValue());
        }

        return Optional.empty();
    }

    private static void resolveScopes(SeampactBoundary boundary, BoundaryExchange exchange) {
        ContractRoute route = exchange.route();

        for (JsonNode entry : route.operation().path("scopes")) {
            String scope = entry.path("scope").asString();
            JsonNode idType = boundary.table().ir().path("scopes").path(scope).path("idSchema");
            Object id = declaredValue(boundary, exchange, entry.path("source"), idType);
            ScopeResolver resolver = scopeResolverFor(boundary, scope);

            ScopeResolution<ResolvedScope<?, ?>, Denial> resolution = resolver.resolveScope(new ScopeCall(scope,
                    new ScopeIdSource.Declared<>(id), exchange.principal, List.copyOf(exchange.scopes),
                    new ResolveScopeRequest.Extensions<>(Map.of(), Map.of())));

            switch (resolution) {
                case ScopeResolution.Resolved<ResolvedScope<?, ?>, Denial> resolved -> exchange.scopes.add(resolved.resolved());
                case ScopeResolution.Denied<ResolvedScope<?, ?>, Denial> denied -> throw refusalOf(boundary, denied.deny());
            }
        }
    }

    // A value a scope or a subject reads from the request: a path parameter, decoded and checked by its type.
    private static Object declaredValue(SeampactBoundary boundary, BoundaryExchange exchange, JsonNode source, JsonNode typeUse) {
        String in = source.path("in").asString();
        if (!"path".equals(in)) {
            throw new IllegalStateException("seampact: a value read from '" + in + "' is not one the boundary resolves yet");
        }

        String name = source.path("name").asString();
        JsonNode value = WireDecoding.decode(exchange.pathParams().getOrDefault(name, ""), typeUse);
        List<InputIssue> issues = boundary.validator().issuesOf(value, typeUse, "path", InputIssue.below("", name));
        if (!issues.isEmpty()) throw InputStep.schemaInvalid(exchange.route(), issues);

        return ScalarValues.of(value, typeUse);
    }

    private static void decideRequirements(SeampactBoundary boundary, BoundaryExchange exchange, RequestView view) {
        for (JsonNode requirement : exchange.route().operation().path("requires")) {
            boolean isRule = requirement.has("rule");
            String name = (isRule ? requirement.path("rule") : requirement.path("right")).asString();
            Optional<SubjectRef<Object, Object>> subject = subjectOf(boundary, exchange, requirement.path("subject"), name);
            Optional<JsonNode> params = requirement.has("params") ? Optional.of(requirement.path("params")) : Optional.empty();

            Decision<Denial> decision = decide(boundary, name, new RequirementCall(isRule ? RequirementKind.RULE : RequirementKind.RIGHT,
                    name, params, exchange.principal, subject, List.copyOf(exchange.scopes), Optional.empty(), Optional.empty(),
                    new Purpose.Route(), boundary.operationRef(exchange.route()), view,
                    new RequirementRequest.Extensions<>(Map.of(), Map.of())));

            if (decision instanceof Decision.Denied<Denial> denied) throw refusalOf(boundary, denied.deny());
        }
    }

    private static Optional<SubjectRef<Object, Object>> subjectOf(SeampactBoundary boundary, BoundaryExchange exchange, JsonNode subject, String name) {
        if (subject.isMissingNode()) return Optional.empty();

        JsonNode source = subject.path("source");
        if ("scope".equals(source.path("in").asString())) {
            String scope = source.path("name").asString();
            return exchange.scopes.stream()
                    .filter(resolved -> resolved.scope().equals(scope))
                    .findFirst()
                    .map(resolved -> new SubjectRef<Object, Object>(scope, resolved.id(), Optional.empty()));
        }

        JsonNode right = boundary.table().ir().path("rights").path(name).path("subject");
        Object id = declaredValue(boundary, exchange, source, right.path("idSchema"));

        return Optional.of(new SubjectRef<>(subjectType(right), id, Optional.empty()));
    }

    /** The subject type a right names: its scope, or its resource type's name. */
    static String subjectType(JsonNode rightSubject) {
        if (rightSubject.has("scope")) return rightSubject.path("scope").asString();

        StringBuilder type = new StringBuilder();
        for (JsonNode segment : rightSubject.path("type").path("segments")) {
            if (!type.isEmpty()) type.append('.');
            type.append(segment.asString());
        }

        return type.toString();
    }

    /** Asks the decider of [name]; Spring Security's `AccessDeniedException` is the right's first declared code. */
    static Decision<Denial> decide(SeampactBoundary boundary, String name, RequirementCall call) {
        try {
            return deciderFor(boundary, name).decide(call);
        } catch (RuntimeException failure) {
            if (!isAccessDenied(failure)) throw failure;

            JsonNode declaration = boundary.table().ir().path(call.kind() == RequirementKind.RULE ? "rules" : "rights").path(name);
            return new Decision.Denied<>(Denial.of(declaration.path("errors").path(0).asString()));
        }
    }

    static Decider deciderFor(SeampactBoundary boundary, String name) {
        Map<String, Decider> deciders = boundary.beans().getBeansOfType(Decider.class);

        return deciders.values().stream().filter(decider -> decider.names().contains(name)).findFirst()
                .or(() -> deciders.values().stream().filter(decider -> decider.names().contains(Decider.EVERY_NAME)).findFirst())
                .orElseThrow(() -> new IllegalStateException("seampact: no decider bean serves '" + name + "'"));
    }

    static ScopeResolver scopeResolverFor(SeampactBoundary boundary, String scope) {
        return boundary.beans().getBeansOfType(ScopeResolver.class).values().stream()
                .filter(resolver -> resolver.scope().equals(scope))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("seampact: no scope resolver bean serves '" + scope + "'"));
    }

    static boolean isAccessDenied(Throwable failure) {
        for (Class<?> type = failure.getClass(); type != null; type = type.getSuperclass()) {
            if (type.getName().equals(ACCESS_DENIED)) return true;
        }

        return false;
    }

    private static ContractRefusal refusalOf(SeampactBoundary boundary, Denial denial) {
        JsonNode params = denial.params().map(value -> boundary.mapper().<JsonNode>valueToTree(value)).orElse(MissingNode.getInstance());

        return new ContractRefusal(denial.code(), params);
    }
}
