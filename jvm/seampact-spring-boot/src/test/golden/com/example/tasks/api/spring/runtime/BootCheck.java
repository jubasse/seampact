package com.example.tasks.api.spring.runtime;

import jakarta.servlet.Filter;
import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.SpringBootVersion;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import tools.jackson.databind.JsonNode;

/**
 * The boot check (ADR 0022 "The boot check"), once every bean is built and before the server starts: it lists every
 * problem at once (a missing hook, a contract operation with no handler or two, a framework route the config does
 * not allow-list, a filter ordered before the boundary, an unsupported Spring Boot major) and throws, so the app
 * does not start.
 */
public final class BootCheck implements SmartInitializingSingleton {
    private static final String SUPPORTED_BOOT_MAJOR = "4";
    private static final String OPERATION_ID_ATTRIBUTE = "operationId";
    private static final String ERROR_PATH_PROPERTY = "server.error.path";
    private static final String SPRINGDOC_PATH_PROPERTY = "springdoc.api-docs.path";
    private static final String SPRINGDOC_UI_PROPERTY = "springdoc.swagger-ui.path";
    private static final Set<String> BODY_READING_FILTERS = Set.of(
            "org.springframework.web.filter.FormContentFilter",
            "org.springframework.web.filter.HiddenHttpMethodFilter",
            "org.springframework.web.filter.ShallowEtagHeaderFilter");

    private final SeampactBoundary boundary;
    private final AntPathMatcher paths = new AntPathMatcher();

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
                if (accepted.contains(pattern) || isAllowListed(methods, pattern)) continue;
                problems.add("the framework route " + (methods.isEmpty() ? "" : String.join(",", methods) + " ") + pattern
                        + " is outside the contract and not allow-listed; fix: add it to the entry's frameworkRoutes with a reason, or remove it.");
            }
        }
    }

    private boolean isAllowListed(Set<String> methods, String pattern) {
        for (JsonNode allowed : boundary.table().settings().path("frameworkRoutes")) {
            String method = allowed.path("method").asString("");
            boolean methodAllowed = method.isEmpty() || (methods.size() == 1 && methods.contains(method));
            if (methodAllowed && paths.match(allowed.path("path").asString(), pattern)) return true;
        }

        return false;
    }

    private List<String> acceptedFrameworkPaths() {
        String docs = boundary.environment().getProperty(SPRINGDOC_PATH_PROPERTY, "/v3/api-docs");
        String errorPath = boundary.environment().getProperty(ERROR_PATH_PROPERTY, "/error");

        return List.of(errorPath, docs, docs + ".yaml", docs + "/swagger-config",
                boundary.environment().getProperty(SPRINGDOC_UI_PROPERTY, "/swagger-ui.html"));
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
