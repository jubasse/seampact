package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.hooks.ResolvedScope;
import io.github.jubasse.seampact.hooks.ScopeResolution;
import io.github.jubasse.seampact.hooks.ThrottleBucket;
import jakarta.servlet.http.Cookie;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.method.HandlerMethod;
import tools.jackson.databind.json.JsonMapper;

/**
 * Steps 2 to 5 (ADR 0012 "The check order") without a server: authenticate, scope resolution and decide, each denial,
 * a hook that throws (the api's 500, never an allow) and the throttle bucket a rule is handed.
 */
class AccessStepsTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();
    private static final String PROJECT_ID = "p1";

    private static final String TABLE = """
            {"api": {"id": "tasks"},
             "errors": {
               "api.unauthenticated": {"code": "api.unauthenticated", "family": "api", "nature": "refused", "http": {"status": 401}, "default": "unauthenticated"},
               "api.csrf_invalid": {"code": "api.csrf_invalid", "family": "api", "nature": "refused", "http": {"status": 403}, "default": "csrfInvalid"},
               "api.forbidden": {"code": "api.forbidden", "family": "api", "nature": "refused", "http": {"status": 403}},
               "api.project_missing": {"code": "api.project_missing", "family": "api", "nature": "refused", "http": {"status": 404}},
               "api.internal": {"code": "api.internal", "family": "api", "nature": "failed", "http": {"status": 500}, "default": "undeclaredStatus"}},
             "identities": {"session": {"kind": "bearer"}},
             "schemes": {"token": {"kind": "bearer"}, "sid": {"kind": "cookie", "name": "sid"}},
             "scopes": {"project": {"idSchema": {"kind": "scalar", "refinements": {}, "type": "string"}}},
             "rights": {"canRead": {"errors": ["api.forbidden"]}},
             "buckets": {"perProject": {"key": [{"in": "path", "name": "projectId"}], "limit": 5, "windowMs": 60000}},
             "formats": {"bare": {"error": {"media": "application/json", "headers": [], "body": {"kind": "object",
               "members": [{"name": {"kind": "text", "text": "code"}, "value": {"kind": "slot", "slot": "code", "path": []}}]}}}},
             "operations": [
               {"id": "readProject", "method": "get", "path": "/projects/{projectId}", "safe": true, "format": "bare",
                "params": {"path": [{"name": "projectId", "required": true, "type": {"kind": "scalar", "refinements": {}, "type": "string"}}], "query": [], "header": []},
                "access": {"kind": "required", "identity": "session", "schemes": ["token"]},
                "scopes": [{"scope": "project", "source": {"in": "path", "name": "projectId"}}],
                "requires": [{"right": "canRead"}],
                "errors": [{"code": "api.unauthenticated"}, {"code": "api.forbidden"}, {"code": "api.project_missing"}, {"code": "api.internal"}]},
               {"id": "readOptional", "method": "get", "path": "/optional", "safe": true, "format": "bare",
                "access": {"kind": "optional", "identity": "session", "schemes": ["token"], "onRefused": "anonymous"},
                "errors": [{"code": "api.unauthenticated"}, {"code": "api.internal"}]},
               {"id": "writeSession", "method": "post", "path": "/session", "safe": false, "format": "bare",
                "access": {"kind": "required", "identity": "session", "schemes": ["sid"]},
                "csrf": {"header": "X-Csrf"},
                "errors": [{"code": "api.unauthenticated"}, {"code": "api.csrf_invalid"}, {"code": "api.internal"}]},
               {"id": "throttled", "method": "get", "path": "/throttled/{projectId}", "safe": true, "format": "bare",
                "params": {"path": [{"name": "projectId", "required": true, "type": {"kind": "scalar", "refinements": {}, "type": "string"}}], "query": [], "header": []},
                "requires": [{"right": "canRead", "bucket": "perProject"}],
                "errors": [{"code": "api.forbidden"}, {"code": "api.internal"}]},
               {"id": "ghostBucket", "method": "get", "path": "/ghost/{projectId}", "safe": true, "format": "bare",
                "params": {"path": [{"name": "projectId", "required": true, "type": {"kind": "scalar", "refinements": {}, "type": "string"}}], "query": [], "header": []},
                "requires": [{"right": "canRead", "bucket": "ghost"}],
                "errors": [{"code": "api.forbidden"}, {"code": "api.internal"}]}]}
            """;

    @Retention(RetentionPolicy.RUNTIME)
    @interface ReadProjectOperation {}

    @Retention(RetentionPolicy.RUNTIME)
    @interface GhostBucketOperation {}

    /** The handler Spring would choose for `readProject`. */
    static final class Controller {
        @ReadProjectOperation
        void readProject() {}

        @GhostBucketOperation
        void ghostBucket() {}
    }

    @Test
    void aRequestWithoutCredentialsIsTheUnauthenticatedRefusal() {
        Fixture fixture = new Fixture("readProject");

        ContractRefusal refusal = assertThrows(ContractRefusal.class, fixture::run);

        assertEquals("api.unauthenticated", refusal.code());
        assertFalse(fixture.hookCalled, "no credential, no authenticate hook call");
    }

    @Test
    void anAuthenticatedPrincipalReachesTheScopeResolverAndTheDecider() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");

        fixture.run();

        assertEquals("alice", fixture.exchange.principal);
        assertEquals(List.of("project"), fixture.exchange.scopes.stream().map(ResolvedScope::scope).toList());
        assertEquals(PROJECT_ID, fixture.exchange.scopes.getFirst().id());
        assertEquals(List.of("canRead"), fixture.decidedNames);
        assertEquals("secret", fixture.credentials.path("token").asString());
    }

    @Test
    void anAuthenticateDenialIsRefusedWithItsCodeAndParams() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.authenticate = (identity, credentials, csrf) -> new AuthenticateResult.Denied<String, Denial>(Denial.of("api.forbidden", Map.of("why", "expired")));

        ContractRefusal refusal = assertThrows(ContractRefusal.class, fixture::run);

        assertEquals("api.forbidden", refusal.code());
        assertEquals("expired", refusal.params().path("why").asString());
    }

    @Test
    void anOptionalRouteWithoutCredentialsRunsAnonymously() {
        Fixture fixture = new Fixture("readOptional");

        fixture.run();

        assertNull(fixture.exchange.principal);
        assertFalse(fixture.hookCalled);
    }

    @Test
    void anOptionalRouteWhoseCredentialIsRefusedRunsAnonymouslyWhenTheRouteSaysSo() {
        Fixture fixture = new Fixture("readOptional");
        fixture.request.addHeader("Authorization", "Bearer stale");
        fixture.authenticate = (identity, credentials, csrf) -> new AuthenticateResult.Denied<String, Denial>(Denial.of("api.unauthenticated"));

        fixture.run();

        assertTrue(fixture.hookCalled);
        assertNull(fixture.exchange.principal);
    }

    @Test
    void aCookieCredentialWithoutTheCsrfHeaderIsTheCsrfInvalidRefusal() {
        Fixture fixture = new Fixture("writeSession");
        fixture.request.setCookies(new Cookie("sid", "abc"));

        ContractRefusal refusal = assertThrows(ContractRefusal.class, fixture::run);

        assertEquals("api.csrf_invalid", refusal.code());
        assertFalse(fixture.hookCalled);
    }

    @Test
    void aCookieCredentialWithTheCsrfHeaderReachesTheHookWithTheToken() {
        Fixture fixture = new Fixture("writeSession");
        fixture.request.setCookies(new Cookie("sid", "abc"));
        fixture.request.addHeader("X-Csrf", "token-1");

        fixture.run();

        assertEquals(Optional.of("token-1"), fixture.csrfToken);
        assertEquals("abc", fixture.credentials.path("sid").asString());
    }

    @Test
    void aScopeDenialIsRefusedWithItsCodeAndTheDeciderNeverRuns() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.resolve = call -> new ScopeResolution.Denied<>(Denial.of("api.project_missing"));

        ContractRefusal refusal = assertThrows(ContractRefusal.class, fixture::run);

        assertEquals("api.project_missing", refusal.code());
        assertTrue(fixture.decidedNames.isEmpty());
    }

    @Test
    void aResolverAnsweringAnotherScopeStopsTheRequest() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.resolve = call -> new ScopeResolution.Resolved<>(new ResolvedScope<>("team", "t1", Optional.empty()));

        IllegalStateException failure = assertThrows(IllegalStateException.class, fixture::run);

        assertEquals("seampact: the resolver of scope 'project' answered scope 'team'", failure.getMessage());
    }

    @Test
    void aMissingScopeResolverBeanIsNamed() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.withResolver = false;

        IllegalStateException failure = assertThrows(IllegalStateException.class, fixture::run);

        assertEquals("seampact: no scope resolver bean serves 'project'", failure.getMessage());
    }

    @Test
    void aDeciderDenialIsRefusedWithItsCodeAndParams() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.decide = call -> new Decision.Denied<>(Denial.of("api.forbidden", Map.of("need", "owner")));

        ContractRefusal refusal = assertThrows(ContractRefusal.class, fixture::run);

        assertEquals("api.forbidden", refusal.code());
        assertEquals("owner", refusal.params().path("need").asString());
    }

    @Test
    void springSecuritysAccessDeniedInADeciderIsTheFirstDeclaredCodeOfTheRight() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.decide = call -> {
            throw new AccessDeniedException("no");
        };

        ContractRefusal refusal = assertThrows(ContractRefusal.class, fixture::run);

        assertEquals("api.forbidden", refusal.code());
    }

    @Test
    void aMissingDeciderBeanIsNamed() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.withDecider = false;

        IllegalStateException failure = assertThrows(IllegalStateException.class, fixture::run);

        assertEquals("seampact: no decider bean serves 'canRead'", failure.getMessage());
    }

    @Test
    void aDeciderBeanOfEveryNameServesARequirementNoBeanNames() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.deciderNames = Set.of(Decider.EVERY_NAME);

        fixture.run();

        assertEquals(List.of("canRead"), fixture.decidedNames);
    }

    @Test
    void anAuthenticateHookThatThrowsAnswersTheApisInternalErrorAndNeverAdmits() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.authenticate = (identity, credentials, csrf) -> {
            throw new IllegalStateException("identity store down");
        };

        fixture.assertAnswersInternalErrorWithoutAdmitting();
        assertTrue(fixture.decidedNames.isEmpty());
    }

    @Test
    void aScopeResolverThatThrowsAnswersTheApisInternalErrorAndNeverAdmits() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.resolve = call -> {
            throw new IllegalStateException("scope store down");
        };

        fixture.assertAnswersInternalErrorWithoutAdmitting();
        assertTrue(fixture.decidedNames.isEmpty());
    }

    @Test
    void aDeciderThatThrowsAnswersTheApisInternalErrorAndNeverAdmits() {
        Fixture fixture = new Fixture("readProject");
        fixture.request.addHeader("Authorization", "Bearer secret");
        fixture.decide = call -> {
            throw new IllegalStateException("policy store down");
        };

        fixture.assertAnswersInternalErrorWithoutAdmitting();
    }

    @Test
    void aThrottleRuleIsHandedItsBucketWithTheDigestOfItsKey() {
        Fixture fixture = new Fixture("throttled", Map.of("projectId", PROJECT_ID));

        fixture.run();

        ThrottleBucket bucket = fixture.bucket.orElseThrow();
        assertEquals("perProject", bucket.id());
        assertEquals(List.of(PROJECT_ID), bucket.values());
        assertEquals(Optional.of(5L), bucket.limit());
        assertEquals(Optional.of(60000L), bucket.windowMs());
        // sha256 of `["tasks","perProject",["p1"]]`, the text every target digests.
        assertEquals(Digests.hexOf("[\"tasks\",\"perProject\",[\"p1\"]]".getBytes(StandardCharsets.UTF_8)), bucket.key());
    }

    @Test
    void aBucketMissingFromTheTableIsNamedAndTheRequestIsNeverAdmitted() {
        Fixture fixture = new Fixture("ghostBucket", Map.of("projectId", PROJECT_ID));

        IllegalStateException failure = assertThrows(IllegalStateException.class, fixture::run);

        assertEquals("seampact: the contract table has no throttle bucket 'ghost'; regenerate the Spring Boot sources", failure.getMessage());
        assertTrue(fixture.decidedNames.isEmpty());

        fixture.assertAnswersInternalErrorWithoutAdmitting();
        assertTrue(fixture.decidedNames.isEmpty());
    }

    @Test
    void aPathParamTheRequestLacksIsTheEmptyValueOfTheBucketKey() {
        Fixture fixture = new Fixture("throttled", Map.of());

        fixture.run();

        assertEquals(List.of(""), fixture.bucket.orElseThrow().values());
    }

    /** One request through the steps with scripted hooks. */
    private static final class Fixture {
        final MockHttpServletRequest request = new MockHttpServletRequest("GET", "/");
        final MockHttpServletResponse servletResponse = new MockHttpServletResponse();
        final String operationId;
        final Map<String, String> pathParams;
        final List<String> decidedNames = new ArrayList<>();

        TasksTestBinding.Authenticator authenticate = (identity, credentials, csrf) -> new AuthenticateResult.Authenticated<String, Denial>("alice");
        Function<ScopeCall, ScopeResolution<ResolvedScope<?, ?>, Denial>> resolve =
                call -> new ScopeResolution.Resolved<>(new ResolvedScope<>("project", ((io.github.jubasse.seampact.hooks.ScopeIdSource.Declared<?>) call.source()).id(), Optional.empty()));
        Function<RequirementCall, Decision<Denial>> decide = call -> new Decision.Allowed<>();
        Set<String> deciderNames = Set.of("canRead");
        boolean withResolver = true;
        boolean withDecider = true;
        boolean hookCalled;
        tools.jackson.databind.JsonNode credentials;
        Optional<String> csrfToken = Optional.empty();
        Optional<ThrottleBucket> bucket = Optional.empty();
        BoundaryExchange exchange;
        SeampactBoundary boundary;

        Fixture(String operationId) {
            this(operationId, Map.of(PROJECT_ID, PROJECT_ID, "projectId", PROJECT_ID));
        }

        Fixture(String operationId, Map<String, String> pathParams) {
            this.operationId = operationId;
            this.pathParams = pathParams;
        }

        void run() {
            build();
            AccessSteps.run(boundary, exchange, request);
        }

        private void build() {
            StaticListableBeanFactory beans = new StaticListableBeanFactory();
            if (withDecider) beans.addBean("decider", new ScriptedDecider());
            if (withResolver) beans.addBean("resolver", new ScriptedResolver());
            TasksTestBinding binding = new TasksTestBinding(Map.of()).withAnnotations(Map.of("readProject", ReadProjectOperation.class, "ghostBucket", GhostBucketOperation.class))
                    .withAuthenticator((identity, credentialsRead, csrf) -> {
                        hookCalled = true;
                        credentials = credentialsRead;
                        csrfToken = csrf;
                        return authenticate.authenticate(identity, credentialsRead, csrf);
                    });
            boundary = new SeampactBoundary(TABLE, binding, beans, new StandardEnvironment());
            ContractRoute route = boundary.table().routes().stream().filter(candidate -> candidate.id().equals(operationId)).findFirst().orElseThrow();
            exchange = new BoundaryExchange(new ContractTable.RouteMatch(route, pathParams), route.operation().path("path").asString(),
                    new CheckingResponse(servletResponse, false));
            boundary.attach(request, exchange);
        }

        // The same steps behind the interceptor, which writes the 500 for any hook failure.
        void assertAnswersInternalErrorWithoutAdmitting() {
            if (exchange == null) build();
            HandlerMethod handler = handlerOf(Controller.class, operationId);
            BoundaryExchange served = new BoundaryExchange(new ContractTable.RouteMatch(exchange.route(), Map.of("projectId", PROJECT_ID)), "/projects/p1",
                    new CheckingResponse(new MockHttpServletResponse(), false));
            boundary.attach(request, served);

            boolean admitted = new BoundaryInterceptor(boundary).preHandle(request, servletResponse, handler);

            assertFalse(admitted);
            assertFalse(served.admitted);
            assertEquals(500, served.response.heldStatus());
            assertEquals("api.internal", MAPPER.readTree(new String(served.response.heldBody(), StandardCharsets.UTF_8)).path("code").asString());
        }

        private final class ScriptedDecider implements Decider {
            @Override
            public Set<String> names() {
                return deciderNames;
            }

            @Override
            public Decision<Denial> decide(RequirementCall call) {
                decidedNames.add(call.name());
                bucket = call.bucket();

                return decide.apply(call);
            }
        }

        private final class ScriptedResolver implements ScopeResolver {
            @Override
            public String scope() {
                return "project";
            }

            @Override
            public ScopeResolution<ResolvedScope<?, ?>, Denial> resolveScope(ScopeCall call) {
                return resolve.apply(call);
            }
        }
    }

    private static HandlerMethod handlerOf(Class<?> controller, String name) {
        try {
            Method method = controller.getDeclaredMethod(name);
            Object instance = controller.getDeclaredConstructor().newInstance();

            return new HandlerMethod(instance, method);
        } catch (ReflectiveOperationException failure) {
            throw new AssertionError(failure);
        }
    }
}
