package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.hooks.IdempotencyBegin;
import io.github.jubasse.seampact.hooks.IdempotencyClaim;
import io.github.jubasse.seampact.hooks.IdempotencyStore;
import io.github.jubasse.seampact.hooks.ResolvedScope;
import io.github.jubasse.seampact.hooks.ScopeResolution;
import io.github.jubasse.seampact.hooks.StoredResponse;
import java.lang.annotation.Annotation;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.server.servlet.ServletWebServerFactory;
import org.springframework.boot.web.servlet.ServletContextInitializer;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.core.Ordered;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.filter.FormContentFilter;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/** The boot check (ADR 0022 "The boot check"): each problem it refuses to start with, named with its fix. */
class BootCheckTest {
    private static final String TABLE = """
            {"api": {"id": "tasks", "surfaces": {"app": {"prefix": "/v1"}}%API_EXTRA%},
             "errors": {"api.forbidden": {"code": "api.forbidden", "family": "api", "nature": "refused", "http": {"status": 403}}},
             "rights": {"canList": {"errors": ["api.forbidden"]}, "canSeeEffort": {"errors": ["api.forbidden"]}},
             "operations": [
               {"id": "listTasks", "method": "get", "path": "/v1/tasks", "surface": "app",
                "scopes": [{"scope": "project", "source": {"in": "path", "name": "projectId"}}],
                "requires": [{"right": "canList"}],
                "fieldRights": [{"direction": "output", "schema": "Task", "pointer": "/effort", "right": "canSeeEffort"}],
                "errors": [{"code": "api.forbidden"}]},
               {"id": "createTask", "method": "post", "path": "/v1/tasks", "surface": "app",
                "access": {"kind": "required", "identity": "session", "schemes": []},
                "idempotency": {"kind": "derived", "enforce": "boundary", "header": "Idempotency-Key"},
                "errors": []}],
             "settings": {%SETTINGS%}}
            """;

    @Retention(RetentionPolicy.RUNTIME)
    @RequestMapping
    @interface ListTasksOperation {
        String operationId() default "listTasks";
    }

    @Retention(RetentionPolicy.RUNTIME)
    @RequestMapping
    @interface CreateTaskOperation {
        String operationId() default "createTask";
    }

    interface TasksDecider extends Decider {}

    interface TasksScopeResolver extends ScopeResolver {}

    interface SessionAuthenticate {}

    /** The controller the app writes, and a framework route beside it. */
    static final class Controller {
        @ListTasksOperation
        void listTasks() {}

        @ListTasksOperation
        void listTasksToo() {}

        @CreateTaskOperation
        void createTask() {}

        void health() {}
    }

    @Test
    void aWholeAppStarts() {
        assertEquals(List.of(), new World().problems());
    }

    @Test
    void aMissingAuthenticateHookIsNamedWithTheInterfaceToImplement() {
        World world = new World();
        world.beans.remove("session");

        assertEquals(List.of("operation 'createTask': no authenticate hook for the identity 'session'; fix: register a bean implementing SessionAuthenticate."),
                world.problems());
    }

    @Test
    void aRequirementNoDeciderServesIsNamedForARouteRequirementAndAFieldRight() {
        World world = new World();
        world.beans.remove("decider");
        world.beans.put("decider", new NamedDecider("canList"));

        assertEquals(List.of("operation 'listTasks': no decider for 'canSeeEffort'; fix: register a TasksDecider bean whose names() hold 'canSeeEffort', or Decider.EVERY_NAME."),
                world.problems());
    }

    @Test
    void twoDecidersClaimingOneNameStopTheBoot() {
        World world = new World();
        world.beans.put("other", new NamedDecider("canList"));

        assertEquals(List.of("two deciders claim 'canList' (decider, other); fix: keep 'canList' in one decider's names."), world.problems());
    }

    @Test
    void aMissingScopeResolverIsNamed() {
        World world = new World();
        world.beans.remove("resolver");

        assertEquals(List.of("operation 'listTasks': no scope resolver for the scope 'project'; fix: register a TasksScopeResolver bean whose scope() is 'project'."),
                world.problems());
    }

    @Test
    void aHookBeanOfNoGeneratedInterfaceIsNamed() {
        World world = new World();
        world.beans.put("stray", new NamedDecider("canList") {}.asRuntimeOnly());

        assertEquals(List.of("the bean 'stray' implements Decider but no interface an api generates from it, so no api calls it; fix: implement the interface its api"
                + " generates, TasksDecider for the api 'tasks'."), world.problems());
    }

    @Test
    void anIdempotentOperationNeedsExactlyOneStore() {
        World none = new World();
        none.beans.remove("store");
        World two = new World();
        two.beans.put("second", new NoStore());
        String problem = "operation 'createTask': it is idempotent and needs exactly one IdempotencyStore bean; fix: register one, such as a store on the app's database.";

        assertEquals(List.of(problem), none.problems());
        assertEquals(List.of(problem), two.problems());
    }

    @Test
    void anOperationWithoutAHandlerIsNamedWithItsAnnotation() {
        World world = new World();
        world.mapping = new RequestMappingHandlerMapping();
        world.register("/v1/tasks", RequestMethod.GET, "listTasks");

        assertEquals(List.of("operation 'createTask': no handler is bound; fix: implement it in a @RestController with @CreateTaskOperation, or set"
                + " seampact.tasks.unbound-operations=warn in a test slice that loads some controllers."), world.problems());
    }

    @Test
    void underWarnAnOperationWithoutAHandlerStartsAndAnswersTheApis404() {
        World world = new World();
        world.mapping = new RequestMappingHandlerMapping();
        world.register("/v1/tasks", RequestMethod.GET, "listTasks");
        world.environment.setProperty("seampact.tasks.unbound-operations", "warn");

        assertEquals(List.of(), world.problems());
        assertTrue(world.boundary.answersNotFound("createTask"));
        assertFalse(world.boundary.answersNotFound("listTasks"));
    }

    @Test
    void anUnknownUnboundOperationsValueIsRefused() {
        World world = new World();
        world.environment.setProperty("seampact.tasks.unbound-operations", "ignore");

        assertEquals(List.of("'seampact.tasks.unbound-operations' is 'ignore', not 'error' or 'warn'; fix: set it to 'warn' in a test slice that loads some controllers,"
                + " or remove it."), world.problems());
    }

    @Test
    void twoHandlersBoundToOneOperationAreListed() {
        World world = new World();
        world.register("/v1/tasks", RequestMethod.PUT, "listTasksToo");

        List<String> problems = world.problems();

        assertEquals(1, problems.size());
        assertTrue(problems.getFirst().startsWith("operation 'listTasks': two handlers are bound ("), problems.getFirst());
        assertTrue(problems.getFirst().endsWith("); fix: keep one method with @ListTasksOperation."), problems.getFirst());
    }

    @Test
    void aHandlerMappedOutsideTheMountIsNamedWithTheMountedPath() {
        World world = new World();
        world.mapping = new RequestMappingHandlerMapping();
        world.register("/v1/tasks", RequestMethod.GET, "listTasks");
        world.register("/api/v1/tasks", RequestMethod.POST, "createTask");

        List<String> problems = world.problems();

        assertEquals(1, problems.size());
        assertTrue(problems.getFirst().startsWith("operation 'createTask': Spring MVC maps its handler "), problems.getFirst());
        assertTrue(problems.getFirst().contains(" at /api/v1/tasks, not at the entry's mount followed by the contract path, /v1/tasks; fix: remove the path prefix"), problems.getFirst());
    }

    @Test
    void aFrameworkRouteOutsideTheContractIsRefusedUnlessAllowListed() {
        World world = new World();
        world.register("/v1/health", RequestMethod.GET, "health");

        assertEquals(List.of("the framework route GET /v1/health is outside the contract and not allow-listed; fix: add it to the entry's frameworkRoutes with a reason, or remove it."),
                world.problems());

        World allowed = new World("{\"frameworkRoutes\": [{\"method\": \"GET\", \"path\": \"/v1/*\"}]}");
        allowed.register("/v1/health", RequestMethod.GET, "health");

        assertEquals(List.of(), allowed.problems());
    }

    @Test
    void anAllowListedMethodDoesNotAllowAnotherMethod() {
        World world = new World("{\"frameworkRoutes\": [{\"method\": \"GET\", \"path\": \"/v1/health\"}]}");
        world.register("/v1/health", RequestMethod.POST, "health");

        assertEquals(1, world.problems().size());
    }

    @Test
    void aFrameworkRouteOutsideTheApisBasePathsIsReadOnlyUnderTheStrictScope() {
        World lenient = new World();
        lenient.register("/elsewhere", RequestMethod.GET, "health");
        World strict = new World("{\"bootCheck\": {\"frameworkRouteScope\": \"strict\"}}");
        strict.register("/elsewhere", RequestMethod.GET, "health");

        assertEquals(List.of(), lenient.problems());
        assertEquals(List.of("the framework route GET /elsewhere is outside the contract and not allow-listed; fix: add it to the entry's frameworkRoutes with a reason, or remove it."),
                strict.problems());
    }

    @Test
    void theErrorPathAndSpringdocPathsAreAcceptedUnlessTheDocsAreOff() {
        World world = new World("{\"bootCheck\": {\"frameworkRouteScope\": \"strict\"}}");
        world.register("/error", RequestMethod.GET, "health");
        world.register("/v3/api-docs", RequestMethod.GET, "health");
        world.register("/swagger-ui.html", RequestMethod.GET, "health");

        assertEquals(List.of(), world.problems());

        World off = new World("{\"bootCheck\": {\"frameworkRouteScope\": \"strict\"}, \"frameworkDocs\": \"off\"}");
        off.register("/v3/api-docs", RequestMethod.GET, "health");

        List<String> problems = off.problems();
        assertEquals(1, problems.size());
        assertTrue(problems.getFirst().contains("fix: the entry sets frameworkDocs: off; load the generated seampact-tasks.properties with spring.config.import"), problems.getFirst());
    }

    @Test
    void aBodyReadingFilterOrderedBeforeTheBoundaryIsNamed() {
        World world = new World();
        FilterRegistrationBean<FormContentFilter> registration = new FilterRegistrationBean<>(new FormContentFilter());
        registration.setOrder(BoundaryFilter.ORDER - 1);
        world.beans.put("registration", registration);
        world.beans.put("ordered", new OrderedFormFilter());

        List<String> problems = world.problems();

        assertEquals(2, problems.size());
        assertTrue(problems.getFirst().startsWith("the filter org.springframework.web.filter.FormContentFilter is ordered at " + (BoundaryFilter.ORDER - 1)
                + ", before the boundary filter (" + BoundaryFilter.ORDER + "), and reads or changes the request; fix: order it after"), problems.getFirst());
        assertTrue(problems.get(1).contains(OrderedFormFilter.class.getName()), problems.get(1));
    }

    @Test
    void aBodyReadingFilterOrderedAfterTheBoundaryAndAnOtherFilterAreAccepted() {
        World world = new World();
        FilterRegistrationBean<FormContentFilter> after = new FilterRegistrationBean<>(new FormContentFilter());
        after.setOrder(BoundaryFilter.ORDER + 1);
        FilterRegistrationBean<UnrelatedFilter> unrelated = new FilterRegistrationBean<>(new UnrelatedFilter());
        unrelated.setOrder(BoundaryFilter.ORDER - 1);
        world.beans.put("after", after);
        world.beans.put("unrelated", unrelated);

        assertEquals(List.of(), world.problems());
    }

    @Test
    void springSecuritysChainOrderedBeforeTheBoundaryIsNamed() {
        World world = new World();
        world.environment.setProperty("spring.security.filter.order", String.valueOf(BoundaryFilter.ORDER));

        assertEquals(List.of("Spring Security's chain is ordered at " + BoundaryFilter.ORDER + ", before the boundary filter (" + BoundaryFilter.ORDER
                + "); fix: set spring.security.filter.order above " + BoundaryFilter.ORDER + "."), world.problems());
    }

    @Test
    void aMappingOrderedBeforeSpringMvcThatServesAContractPathIsNamed() {
        World world = new World();
        SimpleUrlHandlerMapping earlier = new SimpleUrlHandlerMapping(Map.of("/v1/tasks", new Object()), -1);
        earlier.setApplicationContext(new StaticApplicationContext());
        world.beans.put("legacyMapping", earlier);

        assertEquals(List.of("the mapping 'legacyMapping' is ordered before Spring MVC's and serves /v1/tasks, the path of operation 'listTasks'; fix: order it after"
                + " RequestMappingHandlerMapping or remove that route."), world.problems());
    }

    @Test
    void anAppWithoutSpringMvcIsRefused() {
        World world = new World();
        world.mapping = null;

        List<String> problems = world.problems();

        assertTrue(problems.contains("the app runs no Spring MVC (a reactive or non-web app); fix: the spring-boot target serves Spring MVC on a servlet container."), problems.toString());
    }

    @Test
    void aContainerOtherThanTomcatIsNamedAndTomcatIsAccepted() {
        World world = new World();
        world.beans.put("tomcat", new TomcatServletWebServerFactory());
        world.beans.put("other", new OtherContainerFactory());

        assertEquals(List.of("the servlet container factory is " + OtherContainerFactory.class.getName() + "; fix: the spring-boot target supports Tomcat only."),
                world.problems());
    }

    @Test
    void absoluteUrlsNeedAWellFormedPublicOrigin() {
        String[][] cases = {
                {null, "the api writes absolute URLs ('api.wire.urls: absolute') and 'seampact.tasks.public-origin' is not set; fix: set it to the origin clients call, such as https://api.example.com."},
                {"ftp://x.example", "'seampact.tasks.public-origin' is 'ftp://x.example', which has no http or https scheme; fix: set a scheme (http or https), a host and an optional port, such as https://api.example.com."},
                {"https://x.example/", "'seampact.tasks.public-origin' is 'https://x.example/', which has a path, a query or a fragment (a trailing slash included); fix: set a scheme (http or https), a host and an optional port, such as https://api.example.com."},
                {"https://u:p@x.example", "'seampact.tasks.public-origin' is 'https://u:p@x.example', which carries user info; fix: set a scheme (http or https), a host and an optional port, such as https://api.example.com."},
        };

        for (String[] refused : cases) {
            World world = new World("{}", ", \"wire\": {\"urls\": \"absolute\"}");
            if (refused[0] != null) world.environment.setProperty("seampact.tasks.public-origin", refused[0]);

            assertEquals(List.of(refused[1]), world.problems(), String.valueOf(refused[0]));
        }

        World malformed = new World("{}", ", \"wire\": {\"urls\": \"absolute\"}");
        malformed.environment.setProperty("seampact.tasks.public-origin", "https://");

        // The reason after "not a URI" is the JDK's own wording.
        assertTrue(malformed.problems().getFirst().startsWith("'seampact.tasks.public-origin' is 'https://', which is not a URI ("));

        World valid = new World("{}", ", \"wire\": {\"urls\": \"absolute\"}");
        valid.environment.setProperty("seampact.tasks.public-origin", "https://api.example.com:8443");

        assertEquals(List.of(), valid.problems());
    }

    @Test
    void everyProblemIsListedAtOnceUnderTheApisHeader() {
        World world = new World();
        world.beans.remove("store");
        world.beans.remove("resolver");

        IllegalStateException failure = assertThrows(IllegalStateException.class, world::check);

        assertTrue(failure.getMessage().startsWith("seampact: the api 'tasks' cannot start:\n- operation "), failure.getMessage());
        assertEquals(2, failure.getMessage().split("\n- ", -1).length - 1);
    }

    @Test
    void theSwitchesOfTheEntryTurnTheHookHandlerAndFrameworkRouteChecksOff() {
        World world = new World("{\"bootCheck\": {\"hooks\": false, \"handlers\": false, \"frameworkRoutes\": false}}");
        world.beans.remove("store");
        world.beans.remove("session");
        world.register("/v1/health", RequestMethod.GET, "health");

        assertEquals(List.of(), world.problems());
    }

    /** A decider that serves the names it is given. */
    private static class NamedDecider implements TasksDecider {
        private final Set<String> names;

        NamedDecider(String... names) {
            this.names = Set.of(names);
        }

        @Override
        public Set<String> names() {
            return names;
        }

        @Override
        public Decision<Denial> decide(RequirementCall call) {
            return new Decision.Allowed<>();
        }

        /** The same names behind a bean that implements the runtime type only. */
        Decider asRuntimeOnly() {
            Set<String> served = names;

            return new Decider() {
                @Override
                public Set<String> names() {
                    return served;
                }

                @Override
                public Decision<Denial> decide(RequirementCall call) {
                    return new Decision.Allowed<>();
                }
            };
        }
    }

    private static final class ProjectResolver implements TasksScopeResolver {
        @Override
        public String scope() {
            return "project";
        }

        @Override
        public ScopeResolution<ResolvedScope<?, ?>, Denial> resolveScope(ScopeCall call) {
            return new ScopeResolution.Resolved<>(new ResolvedScope<>("project", "p1", java.util.Optional.empty()));
        }
    }

    private static final class NoStore implements IdempotencyStore {
        @Override
        public IdempotencyBegin begin(IdempotencyClaim claim) {
            return new IdempotencyBegin.Started();
        }

        @Override
        public void complete(String key, StoredResponse response) {}

        @Override
        public void abandon(String key) {}
    }

    private static final class OrderedFormFilter extends FormContentFilter implements Ordered {
        @Override
        public int getOrder() {
            return BoundaryFilter.ORDER - 5;
        }
    }

    private static final class UnrelatedFilter extends jakarta.servlet.http.HttpFilter {
        private static final long serialVersionUID = 1L;
    }

    private static final class OtherContainerFactory implements ServletWebServerFactory {
        @Override
        public WebServer getWebServer(ServletContextInitializer... initializers) {
            throw new UnsupportedOperationException("never started");
        }
    }

    /** An app whose every check passes; a test breaks one thing. */
    private static final class World {
        final Map<String, Object> beans = new LinkedHashMap<>();
        final MockEnvironment environment = new MockEnvironment();
        final String table;
        RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
        SeampactBoundary boundary;

        World() {
            this("{}");
        }

        World(String bootSettings) {
            this(bootSettings, "");
        }

        World(String settings, String apiExtra) {
            String body = settings.substring(1, settings.length() - 1);
            table = TABLE.replace("%API_EXTRA%", apiExtra).replace("%SETTINGS%", body);
            beans.put("decider", new NamedDecider("canList", "canSeeEffort"));
            beans.put("resolver", new ProjectResolver());
            beans.put("store", new NoStore());
            beans.put("session", new SessionAuthenticate() {});
            register("/v1/tasks", RequestMethod.GET, "listTasks");
            register("/v1/tasks", RequestMethod.POST, "createTask");
        }

        void register(String pattern, RequestMethod method, String handlerMethod) {
            Method target = Arrays.stream(Controller.class.getDeclaredMethods()).filter(candidate -> candidate.getName().equals(handlerMethod)).findFirst().orElseThrow();
            RequestMappingInfo info = RequestMappingInfo.paths(pattern).methods(method).build();
            mapping.registerMapping(info, new Controller(), target);
        }

        void check() {
            Map<String, Class<? extends Annotation>> annotations = Map.of("listTasks", ListTasksOperation.class, "createTask", CreateTaskOperation.class);
            TasksTestBinding binding = new TasksTestBinding(Map.of()).withAnnotations(annotations)
                    .withAuthenticateHooks(Map.of("session", SessionAuthenticate.class)).withHookTypes(TasksDecider.class, TasksScopeResolver.class);
            if (mapping != null) beans.put("mapping", mapping);
            StaticListableBeanFactory factory = new StaticListableBeanFactory(beans);
            boundary = new SeampactBoundary(table, binding, factory, environment);

            new BootCheck(boundary).afterSingletonsInstantiated();
        }

        /** The problems the check lists; empty when the app starts. */
        List<String> problems() {
            try {
                check();
            } catch (IllegalStateException refusal) {
                String listed = refusal.getMessage().substring(refusal.getMessage().indexOf("\n- ") + "\n- ".length());

                return Arrays.asList(listed.split("\n- "));
            }

            return List.of();
        }
    }
}
