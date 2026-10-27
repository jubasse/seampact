package io.github.jubasse.seampact.springboot.runtime;

import jakarta.servlet.Filter;
import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.SpringBootVersion;
import org.springframework.boot.web.server.servlet.ServletWebServerFactory;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.handler.AbstractUrlHandlerMapping;
import org.springframework.web.servlet.mvc.method.RequestMappingInfoHandlerMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import io.github.jubasse.seampact.hooks.IdempotencyStore;
import tools.jackson.databind.JsonNode;

/**
 * The boot check (ADR 0022 "The boot check"), once every bean is built and before the server starts: it lists every
 * problem at once (a missing hook, a contract operation with no handler or two, a framework route the config does
 * not allow-list, a filter ordered before the boundary, a mapping ordered before Spring MVC's that takes a contract
 * route, a container other than Tomcat, a reactive
 * app, an unsupported Spring Boot major, a missing or malformed public origin under absolute URLs) and throws, so
 * the app does not start.
 */
public final class BootCheck implements SmartInitializingSingleton {
    private static final String SUPPORTED_BOOT_MAJOR = "4";
    private static final String STRICT_SCOPE = "strict";
    private static final String OPERATION_ID_ATTRIBUTE = "operationId";
    private static final String ERROR_PATH_PROPERTY = "server.error.path";
    private static final String SPRINGDOC_PATH_PROPERTY = "springdoc.api-docs.path";
    private static final String SPRINGDOC_UI_PROPERTY = "springdoc.swagger-ui.path";
    private static final String FRAMEWORK_DOCS_SETTING = "frameworkDocs";
    private static final String FRAMEWORK_DOCS_OFF = "off";
    private static final String TOMCAT_FACTORY = "Tomcat";
    private static final String SAMPLE_SEGMENT = "x";
    private static final List<String> HTTP_METHODS = List.of("GET", "POST", "PUT", "PATCH", "DELETE");
    private static final Set<String> BODY_READING_FILTERS = Set.of(
            "org.springframework.web.filter.FormContentFilter",
            "org.springframework.web.filter.HiddenHttpMethodFilter",
            "org.springframework.web.filter.ShallowEtagHeaderFilter");

    private final SeampactBoundary boundary;

    public BootCheck(SeampactBoundary boundary) {
        this.boundary = boundary;
    }

    @Override
    public void afterSingletonsInstantiated() {
        JsonNode bootCheck = boundary.table().settings().path("bootCheck");
        List<String> problems = new ArrayList<>();

        if (bootCheck.path("hooks").asBoolean(true)) hookProblems(problems);
        if (bootCheck.path("handlers").asBoolean(true)) handlerProblems(problems);
        if (bootCheck.path("frameworkRoutes").asBoolean(true)) frameworkRouteProblems(problems);
        filterProblems(problems);
        earlierMappingProblems(problems);
        platformProblems(problems);
        PublicOrigin.bootProblem(boundary.table(), boundary.environment()).ifPresent(problems::add);
        if (!SpringBootVersion.getVersion().startsWith(SUPPORTED_BOOT_MAJOR + ".")) {
            problems.add("Spring Boot " + SpringBootVersion.getVersion() + " runs the app; fix: the spring-boot target supports Spring Boot 4.x only.");
        }

        if (problems.isEmpty()) return;

        throw new IllegalStateException("seampact: the api '" + boundary.apiId() + "' cannot start:\n- " + String.join("\n- ", problems));
    }

    private void hookProblems(List<String> problems) {
        Map<String, Decider> deciders = boundary.beans().getBeansOfType(Decider.class);
        Map<String, String> claims = new LinkedHashMap<>();
        for (Map.Entry<String, Decider> decider : deciders.entrySet()) {
            for (String name : decider.getValue().names()) {
                String previous = claims.putIfAbsent(name, decider.getKey());
                if (previous != null) problems.add("two deciders claim '" + name + "' (" + previous + ", " + decider.getKey() + "); fix: keep '" + name + "' in one decider's names.");
            }
        }

        Set<String> found = new LinkedHashSet<>();
        for (ContractRoute route : boundary.table().routes()) {
            JsonNode operation = route.operation();
            String identity = operation.path("access").path("identity").asString("");
            Class<?> hook = boundary.binding().authenticateHooks().get(identity);
            if (hook != null && boundary.beans().getBeanNamesForType(hook).length == 0) {
                found.add("operation '" + route.id() + "': no authenticate hook for the identity '" + identity + "'; fix: register a bean implementing " + hook.getSimpleName() + ".");
            }

            for (String name : requirementNames(operation)) {
                if (!claims.containsKey(name) && !claims.containsKey(Decider.EVERY_NAME)) {
                    found.add("operation '" + route.id() + "': no decider for '" + name + "'; fix: register a Decider bean whose names() hold '" + name + "', or Decider.EVERY_NAME.");
                }
            }

            boolean idempotent = "boundary".equals(operation.path("idempotency").path("enforce").asString());
            if (idempotent && boundary.beans().getBeanNamesForType(IdempotencyStore.class).length != 1) {
                found.add("operation '" + route.id() + "': it is idempotent and needs exactly one IdempotencyStore bean; fix: register one, such as"
                        + " a store on the app's database.");
            }

            for (JsonNode scope : operation.path("scopes")) {
                String name = scope.path("scope").asString();
                boolean served = boundary.beans().getBeansOfType(ScopeResolver.class).values().stream().anyMatch(resolver -> resolver.scope().equals(name));
                if (!served) found.add("operation '" + route.id() + "': no scope resolver for the scope '" + name + "'; fix: register a ScopeResolver bean whose scope() is '" + name + "'.");
            }
        }

        problems.addAll(found);
    }

    private static List<String> requirementNames(JsonNode operation) {
        List<String> names = new ArrayList<>();
        operation.path("requires").forEach(requirement -> names.add((requirement.has("rule") ? requirement.path("rule") : requirement.path("right")).asString()));
        operation.path("fieldRights").forEach(fieldRight -> names.add(fieldRight.path("right").asString()));

        return names;
    }

    private void handlerProblems(List<String> problems) {
        Map<String, List<String>> bound = new LinkedHashMap<>();
        for (HandlerMethod handler : handlerMethods().values()) {
            boundary.operationOf(handler.getMethod()).ifPresent(operation -> bound.computeIfAbsent(operation, key -> new ArrayList<>()).add(handler.toString()));
        }

        for (ContractRoute route : boundary.table().routes()) {
            List<String> handlers = bound.getOrDefault(route.id(), List.of());
            Class<? extends Annotation> annotation = boundary.binding().annotations().get(route.id());
            if (handlers.isEmpty()) {
                problems.add("operation '" + route.id() + "': no handler is bound; fix: implement it in a @RestController with @" + annotation.getSimpleName() + ".");
            } else if (handlers.size() > 1) {
                problems.add("operation '" + route.id() + "': two handlers are bound (" + String.join(", ", handlers) + "); fix: keep one method with @" + annotation.getSimpleName() + ".");
            }
        }
    }

    // A mapping no composed annotation of any api registered, outside the allow-list and springdoc's and Boot's paths.
    private void frameworkRouteProblems(List<String> problems) {
        List<String> accepted = acceptedFrameworkPaths();

        for (Map.Entry<RequestMappingInfo, HandlerMethod> mapping : handlerMethods().entrySet()) {
            if (isContractMethod(mapping.getValue().getMethod())) continue;

            Set<String> methods = new LinkedHashSet<>();
            mapping.getKey().getMethodsCondition().getMethods().forEach(method -> methods.add(method.name()));
            for (String pattern : mapping.getKey().getPatternValues()) {
                if (accepted.contains(pattern) || !isInScope(pattern) || isAllowListed(methods, pattern)) continue;
                problems.add("the framework route " + (methods.isEmpty() ? "" : String.join(",", methods) + " ") + pattern
                        + " is outside the contract and not allow-listed; " + frameworkRouteFix(pattern));
            }
        }
    }

    // The default scope reads only a mapping that can serve a path under one of the api's (mounted) base paths;
    // `frameworkRoutes: strict` reads every mapping.
    private boolean isInScope(String pattern) {
        JsonNode bootCheck = boundary.table().settings().path("bootCheck");
        if (STRICT_SCOPE.equals(bootCheck.path("frameworkRouteScope").asString(""))) return true;

        return FrameworkRoutePattern.overlapsAny(boundary.table().basePaths(), pattern);
    }

    private boolean isAllowListed(Set<String> methods, String pattern) {
        for (JsonNode allowed : boundary.table().settings().path("frameworkRoutes")) {
            String method = allowed.path("method").asString("");
            boolean methodAllowed = method.isEmpty() || (methods.size() == 1 && methods.contains(method));
            if (methodAllowed && FrameworkRoutePattern.allows(allowed.path("path").asString(), pattern)) return true;
        }

        return false;
    }

    private List<String> acceptedFrameworkPaths() {
        String errorPath = boundary.environment().getProperty(ERROR_PATH_PROPERTY, "/error");
        if (frameworkDocsOff()) return List.of(errorPath);

        List<String> docs = springdocPaths();
        List<String> accepted = new ArrayList<>(docs.size() + 1);
        accepted.add(errorPath);
        accepted.addAll(docs);

        return accepted;
    }

    private List<String> springdocPaths() {
        String docs = boundary.environment().getProperty(SPRINGDOC_PATH_PROPERTY, "/v3/api-docs");

        return List.of(docs, docs + ".yaml", docs + "/swagger-config",
                boundary.environment().getProperty(SPRINGDOC_UI_PROPERTY, "/swagger-ui.html"));
    }

    // `frameworkDocs: off` (ADR 0022): springdoc's own document is turned off by the generated properties file.
    private boolean frameworkDocsOff() {
        return FRAMEWORK_DOCS_OFF.equals(boundary.table().settings().path(FRAMEWORK_DOCS_SETTING).asString());
    }

    private String frameworkRouteFix(String pattern) {
        if (frameworkDocsOff() && springdocPaths().contains(pattern)) {
            return "fix: the entry sets frameworkDocs: off; load the generated seampact-" + boundary.apiId()
                    + ".properties with spring.config.import, which sets springdoc.api-docs.enabled=false.";
        }

        return "fix: add it to the entry's frameworkRoutes with a reason, or remove it.";
    }

    // A composed annotation of any api: meta-annotated with @RequestMapping and carrying an operation id.
    private static boolean isContractMethod(Method method) {
        for (Annotation annotation : method.getAnnotations()) {
            Class<? extends Annotation> type = annotation.annotationType();
            boolean composed = AnnotatedElementUtils.isAnnotated(type, RequestMapping.class);
            boolean carriesOperation = Arrays.stream(type.getDeclaredMethods()).anyMatch(attribute -> attribute.getName().equals(OPERATION_ID_ATTRIBUTE));
            if (composed && carriesOperation) return true;
        }

        return false;
    }

    // A mapping ordered before Spring MVC's that serves a contract method and path takes the route from the contract
    // handler. A mapping that cannot list its routes (a router function) is left to the run-time rule.
    private void earlierMappingProblems(List<String> problems) {
        int contractOrder = boundary.beans().getBeansOfType(RequestMappingHandlerMapping.class).values().stream()
                .mapToInt(RequestMappingHandlerMapping::getOrder).min().orElse(Ordered.LOWEST_PRECEDENCE);

        for (Map.Entry<String, HandlerMapping> mapping : boundary.beans().getBeansOfType(HandlerMapping.class).entrySet()) {
            HandlerMapping candidate = mapping.getValue();
            boolean earlier = candidate instanceof Ordered ordered && ordered.getOrder() < contractOrder;
            if (!earlier || candidate instanceof RequestMappingHandlerMapping) continue;

            for (Map.Entry<String, List<String>> route : listedRoutes(candidate).entrySet()) {
                String takenOperation = takenOperation(route.getKey(), route.getValue());
                if (takenOperation == null) continue;
                problems.add("the mapping '" + mapping.getKey() + "' is ordered before Spring MVC's and serves " + route.getKey()
                        + ", the path of operation '" + takenOperation + "'; fix: order it after RequestMappingHandlerMapping or remove that route.");
            }
        }
    }

    // The patterns a mapping lists, each with its methods (none for every method).
    private static Map<String, List<String>> listedRoutes(HandlerMapping mapping) {
        Map<String, List<String>> routes = new LinkedHashMap<>();
        if (mapping instanceof RequestMappingInfoHandlerMapping infos) {
            for (RequestMappingInfo info : infos.getHandlerMethods().keySet()) {
                List<String> methods = info.getMethodsCondition().getMethods().stream().map(Enum::name).toList();
                info.getPatternValues().forEach(pattern -> routes.put(pattern, methods));
            }
        } else if (mapping instanceof AbstractUrlHandlerMapping urls) {
            urls.getHandlerMap().keySet().forEach(pattern -> routes.put(pattern, List.of()));
        }

        return routes;
    }

    // The contract operation a pattern serves, its variables read as any segment; null when it serves none.
    private String takenOperation(String pattern, List<String> methods) {
        String samplePath = boundary.servletPath() + pattern.replaceAll("\\{[^/}]+}", SAMPLE_SEGMENT);
        List<String> tried = methods.isEmpty() ? HTTP_METHODS : methods;
        for (String method : tried) {
            Optional<ContractTable.RouteMatch> match = boundary.table().match(method, samplePath);
            if (match.isPresent()) return match.get().route().id();
        }

        return null;
    }

    // The boundary is a servlet filter, tested on Tomcat (ADR 0022 "Refused by name or waiting").
    private void platformProblems(List<String> problems) {
        if (boundary.beans().getBeansOfType(RequestMappingHandlerMapping.class).isEmpty()) {
            problems.add("the app runs no Spring MVC (a reactive or non-web app); fix: the spring-boot target serves Spring MVC on a servlet container.");
        }

        for (ServletWebServerFactory factory : boundary.beans().getBeansOfType(ServletWebServerFactory.class).values()) {
            if (!factory.getClass().getSimpleName().startsWith(TOMCAT_FACTORY)) {
                problems.add("the servlet container factory is " + factory.getClass().getName() + "; fix: the spring-boot target supports Tomcat only.");
            }
        }
    }

    private void filterProblems(List<String> problems) {
        for (FilterRegistrationBean<?> registration : boundary.beans().getBeansOfType(FilterRegistrationBean.class).values()) {
            String filter = registration.getFilter() == null ? "" : registration.getFilter().getClass().getName();
            if (filterOrderedBefore(filter, registration.getOrder())) problems.add(filterProblem(filter, registration.getOrder()));
        }

        for (Filter filter : boundary.beans().getBeansOfType(Filter.class).values()) {
            if (filter instanceof Ordered ordered && filterOrderedBefore(filter.getClass().getName(), ordered.getOrder())) {
                problems.add(filterProblem(filter.getClass().getName(), ordered.getOrder()));
            }
        }

        int securityOrder = boundary.environment().getProperty("spring.security.filter.order", Integer.class, -100);
        if (securityOrder <= BoundaryFilter.ORDER) {
            problems.add("Spring Security's chain is ordered at " + securityOrder + ", before the boundary filter (" + BoundaryFilter.ORDER
                    + "); fix: set spring.security.filter.order above " + BoundaryFilter.ORDER + ".");
        }
    }

    private static boolean filterOrderedBefore(String filterClass, int order) {
        if (order >= BoundaryFilter.ORDER) return false;

        for (String known : BODY_READING_FILTERS) {
            try {
                if (Class.forName(known).isAssignableFrom(Class.forName(filterClass))) return true;
            } catch (ClassNotFoundException absent) {
                continue;
            }
        }

        return false;
    }

    private static String filterProblem(String filterClass, int order) {
        return "the filter " + filterClass + " is ordered at " + order + ", before the boundary filter (" + BoundaryFilter.ORDER
                + "), and reads or changes the request; fix: order it after " + BoundaryFilter.ORDER + ".";
    }

    private Map<RequestMappingInfo, HandlerMethod> handlerMethods() {
        Map<RequestMappingInfo, HandlerMethod> methods = new LinkedHashMap<>();
        boundary.beans().getBeansOfType(RequestMappingHandlerMapping.class).values().forEach(mapping -> methods.putAll(mapping.getHandlerMethods()));

        return methods;
    }
}
