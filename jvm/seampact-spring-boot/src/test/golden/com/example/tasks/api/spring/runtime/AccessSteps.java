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
import io.github.jubasse.seampact.hooks.SignatureEncoding;
import io.github.jubasse.seampact.hooks.SignatureTemplate;
import io.github.jubasse.seampact.hooks.SignedTemplateRequest;
import io.github.jubasse.seampact.hooks.SubjectRef;
import io.github.jubasse.seampact.hooks.ThrottleBucket;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.MissingNode;
import tools.jackson.databind.node.NullNode;
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
    private static final String SIGNED = "signed";

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

        JsonNode identity = boundary.table().ir().path("identities").path(access.path("identity").asString());
        if (SIGNED.equals(identity.path("kind").asString())) {
            authenticateSigned(boundary, exchange, request, view, identity);
            return;
        }

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
                boundary.mapper(), credentials, csrfToken, Optional.empty(), view, boundary.operationRef(route));

        switch (result) {
            case AuthenticateResult.Authenticated<?, Denial> authenticated -> exchange.principal = authenticated.principal();
            case AuthenticateResult.Denied<?, Denial> denied -> {
                if (optional && ANONYMOUS.equals(access.path("onRefused").asString())) return;
                throw refusalOf(boundary, denied.deny());
            }
        }
    }

    // A signed route: the signature parsed from its header over the held raw body; a missing or malformed header is
    // the unauthenticated refusal, and the hook verifies the signature.
    private static void authenticateSigned(SeampactBoundary boundary, BoundaryExchange exchange, HttpServletRequest request, RequestView view, JsonNode identity) {
        ContractRoute route = exchange.route();
        JsonNode scheme = boundary.table().ir().path("schemes").path(identity.path("signed").asString());
        JsonNode signature = scheme.path("signature");

        Optional<SignatureHeader> parsed = SignatureHeader.parse(signature.path("format").asString(), request.getHeader(scheme.path("name").asString()));
        if (parsed.isEmpty()) throw new ContractRefusal(BoundaryFilter.roleCode(route, UNAUTHENTICATED_ROLE), MissingNode.getInstance());

        byte[] rawBody = exchange.body == null ? new byte[0] : exchange.body;
        SignatureTemplate template = new SignatureTemplate(signature.path("algorithm").asString(), signature.path("payload").asString(),
                SignatureEncoding.valueOf(signature.path("encoding").asString().toUpperCase(Locale.ROOT)),
                signature.path("toleranceMs").isNumber() ? Optional.of(signature.path("toleranceMs").asLong()) : Optional.empty());
        SignedTemplateRequest signed = new SignedTemplateRequest(rawBody, parsed.get().timestamp(), parsed.get().candidateSignatures(),
                signature.path("key").path("value").asString(), template);

        AuthenticateResult<?, Denial> result = boundary.binding().authenticate(route.operation().path("access").path("identity").asString(), boundary.beans(), boundary.mapper(),
                JsonNodeFactory.instance.objectNode(), Optional.empty(), Optional.of(signed), view, boundary.operationRef(route));

        switch (result) {
            case AuthenticateResult.Authenticated<?, Denial> authenticated -> exchange.principal = authenticated.principal();
            case AuthenticateResult.Denied<?, Denial> denied -> throw refusalOf(boundary, denied.deny());
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
        return ScalarValues.of(declaredNode(boundary, exchange, source, typeUse), typeUse);
    }

    private static JsonNode declaredNode(SeampactBoundary boundary, BoundaryExchange exchange, JsonNode source, JsonNode typeUse) {
        String in = source.path("in").asString();
        if (!"path".equals(in)) {
            throw new IllegalStateException("seampact: a value read from '" + in + "' is not one the boundary resolves yet");
        }

        String name = source.path("name").asString();
        JsonNode value = WireDecoding.decode(exchange.pathParams().getOrDefault(name, ""), typeUse);
        List<InputIssue> issues = boundary.validator().issuesOf(value, typeUse, "path", InputIssue.below("", name));
        if (!issues.isEmpty()) throw InputStep.schemaInvalid(exchange.route(), issues);

        return value;
    }

    private static void decideRequirements(SeampactBoundary boundary, BoundaryExchange exchange, RequestView view) {
        for (JsonNode requirement : exchange.route().operation().path("requires")) {
            boolean isRule = requirement.has("rule");
            String name = (isRule ? requirement.path("rule") : requirement.path("right")).asString();
            Optional<SubjectRef<Object, Object>> subject = subjectOf(boundary, exchange, requirement.path("subject"), name);
            Optional<JsonNode> params = requirement.has("params") ? Optional.of(requirement.path("params")) : Optional.empty();

            Decision<Denial> decision = decide(boundary, name, new RequirementCall(isRule ? RequirementKind.RULE : RequirementKind.RIGHT,
                    name, params, exchange.principal, subject, List.copyOf(exchange.scopes), isRule ? proofOf(boundary, exchange, name) : Optional.empty(),
                    throttleBucket(boundary, exchange, requirement.path("bucket")),
                    new Purpose.Route(), boundary.operationRef(exchange.route()), view,
                    new RequirementRequest.Extensions<>(Map.of(), Map.of())));

            if (decision instanceof Decision.Denied<Denial> denied) throw refusalOf(boundary, denied.deny());
        }
    }

    /**
     * The body field a rule reads its proof from, checked first: an issue there is the `schemaInvalid` refusal before
     * the decider runs. A body that is absent or not JSON gives no proof; step 6 refuses it.
     */
    private static Optional<Object> proofOf(SeampactBoundary boundary, BoundaryExchange exchange, String rule) {
        String name = boundary.table().ir().path("rules").path(rule).path("proof").path("name").asString("");
        JsonNode proof = proofField(exchange.route().operation(), name);
        if (proof.isMissingNode() || exchange.body == null) return Optional.empty();

        JsonNode body;
        try {
            body = boundary.mapper().readTree(exchange.body);
        } catch (JacksonException malformed) {
            return Optional.empty();
        }
        if (!body.isObject()) return Optional.empty();

        List<InputIssue> issues = InputStep.proofIssues(boundary, body, proof);
        if (!issues.isEmpty()) throw InputStep.schemaInvalid(exchange.route(), issues);

        return Optional.ofNullable(boundary.mapper().treeToValue(body.path(name), Object.class));
    }

    private static JsonNode proofField(JsonNode operation, String name) {
        for (JsonNode proof : operation.path("input").path("proofs")) {
            if (proof.path("name").asString().equals(name)) return proof;
        }

        return MissingNode.getInstance();
    }

    /**
     * The bucket a throttle rule counts in: its key is the SHA-256 hex of `[api, bucket, values]` as the Node targets
     * write it, so a counter shared across targets counts one client once.
     */
    private static Optional<ThrottleBucket> throttleBucket(SeampactBoundary boundary, BoundaryExchange exchange, JsonNode bucketId) {
        if (bucketId.isMissingNode()) return Optional.empty();

        JsonNode bucket = boundary.table().ir().path("buckets").path(bucketId.asString());
        ArrayNode keyValues = JsonNodeFactory.instance.arrayNode();
        for (JsonNode source : bucket.path("key")) keyValues.add(bucketKeyValue(boundary, exchange, source));

        String key = Digests.hexOf(List.of(JsonNodeFactory.instance.stringNode(boundary.apiId()), bucketId, keyValues));
        List<Object> values = new ArrayList<>();
        for (JsonNode value : keyValues) values.add(value.isNull() ? null : boundary.mapper().treeToValue(value, Object.class));

        return Optional.of(new ThrottleBucket(bucketId.asString(), key, values, longOf(bucket.path("limit")), longOf(bucket.path("windowMs"))));
    }

    // A key value as JSON: a path param decoded and checked by its type, a resolved scope's id, a principal member.
    private static JsonNode bucketKeyValue(SeampactBoundary boundary, BoundaryExchange exchange, JsonNode source) {
        String name = source.path("name").asString();

        return switch (source.path("in").asString()) {
            case "path" -> declaredNode(boundary, exchange, source, pathParamType(exchange, name));
            case "scope" -> exchange.scopes.stream().filter(resolved -> resolved.scope().equals(name)).findFirst()
                    .<JsonNode>map(resolved -> boundary.mapper().valueToTree(resolved.id())).orElse(NullNode.getInstance());
            case "principal" -> {
                JsonNode principal = boundary.mapper().valueToTree(exchange.principal);
                yield principal.path(name).isMissingNode() ? NullNode.getInstance() : principal.path(name);
            }
            default -> throw new IllegalStateException("seampact: a bucket key read from '" + source.path("in").asString() + "' is not one the boundary reads");
        };
    }

    private static JsonNode pathParamType(BoundaryExchange exchange, String name) {
        for (JsonNode param : exchange.route().operation().path("params").path("path")) {
            if (param.path("name").asString().equals(name)) return param.path("type");
        }

        throw new IllegalStateException("seampact: the bucket key reads the path param '" + name + "', which the operation does not declare");
    }

    private static Optional<Long> longOf(JsonNode value) {
        return value.isNumber() ? Optional.of(value.asLong()) : Optional.empty();
    }

    static Optional<SubjectRef<Object, Object>> subjectOf(SeampactBoundary boundary, BoundaryExchange exchange, JsonNode subject, String name) {
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

    static ContractRefusal refusalOf(SeampactBoundary boundary, Denial denial) {
        JsonNode params = denial.params().map(value -> boundary.mapper().<JsonNode>valueToTree(value)).orElse(MissingNode.getInstance());

        return new ContractRefusal(denial.code(), params);
    }
}
