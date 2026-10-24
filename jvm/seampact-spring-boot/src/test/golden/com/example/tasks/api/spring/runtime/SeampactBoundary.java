package com.example.tasks.api.spring.runtime;

import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.RequestView;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.lang.annotation.Annotation;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ListableBeanFactory;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.env.Environment;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.MissingNode;

/**
 * One api's boundary: its contract table, the generated binding, the boundary's own mapper and the app's beans, and
 * the replies every piece writes in the api's format. The app's own advice renders a contract error with
 * [renderContractError], and an app filter ordered before the boundary skips contract routes with
 * [isContractRoute].
 */
public final class SeampactBoundary {
    static final Logger LOG = LoggerFactory.getLogger("seampact");

    private static final String STRICT = "strict";
    private static final String WARN = "warn";
    private static final String UNDECLARED_STATUS_ROLE = "undeclaredStatus";
    private static final int INTERNAL_ERROR = 500;
    private static final String SERVLET_PATH_PROPERTY = "spring.mvc.servlet.path";

    private final ContractTable table;
    private final ApiBinding binding;
    private final JsonMapper mapper = BoundaryMapper.create();
    private final StructuralValidator validator;
    private final ListableBeanFactory beans;
    private final Environment environment;
    private final String exchangeAttribute;

    public SeampactBoundary(String tableJson, ApiBinding binding, ListableBeanFactory beans, Environment environment) {
        this.table = new ContractTable(mapper.readTree(tableJson));
        this.binding = binding;
        this.validator = new StructuralValidator(table);
        this.beans = beans;
        this.environment = environment;
        this.exchangeAttribute = SeampactBoundary.class.getName() + "." + table.apiId();
    }

    public String apiId() {
        return table.apiId();
    }

    /** Whether the boundary of this api serves the request: an app filter ordered before it can skip these. */
    public boolean isContractRoute(HttpServletRequest request) {
        return contractPathOf(request).flatMap(path -> table.match(request.getMethod(), path)).isPresent();
    }

    /**
     * Writes [exception], a generated contract exception, as the api's reply on a contract route: for an app's own
     * `@ExceptionHandler` or advice that answers a contract error itself.
     */
    public void renderContractError(HttpServletRequest request, HttpServletResponse response, Throwable exception) {
        BoundaryExchange exchange = exchangeOf(request).orElseThrow(() -> new IllegalStateException(
                "seampact: renderContractError was called outside a contract route of the api '" + apiId() + "'"));
        String code = binding.contractCode(exception).orElseThrow(() -> new IllegalArgumentException(
                "seampact: " + exception.getClass().getName() + " is not a contract exception of the api '" + apiId() + "'"));

        writeRefusal(exchange, new ContractRefusal(code, paramsOf(exception)));
    }

    ContractTable table() {
        return table;
    }

    ApiBinding binding() {
        return binding;
    }

    JsonMapper mapper() {
        return mapper;
    }

    StructuralValidator validator() {
        return validator;
    }

    ListableBeanFactory beans() {
        return beans;
    }

    Environment environment() {
        return environment;
    }

    Optional<BoundaryExchange> exchangeOf(HttpServletRequest request) {
        return request.getAttribute(exchangeAttribute) instanceof BoundaryExchange exchange ? Optional.of(exchange) : Optional.empty();
    }

    void attach(HttpServletRequest request, BoundaryExchange exchange) {
        request.setAttribute(exchangeAttribute, exchange);
    }

    /**
     * The contract path of a request: the raw request target without the request's own context path, read on each
     * request so `X-Forwarded-Prefix` applies, and without the servlet path, stripped as a raw prefix.
     */
    Optional<String> contractPathOf(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (!uri.startsWith(contextPath)) return Optional.empty();

        String servletPath = servletPath();
        String path = uri.substring(contextPath.length());
        if (!path.startsWith(servletPath)) return Optional.empty();

        return Optional.of(path.substring(servletPath.length()));
    }

    String servletPath() {
        String configured = environment.getProperty(SERVLET_PATH_PROPERTY, "");

        return configured.equals("/") ? "" : configured.replaceAll("/+$", "");
    }

    /** The operation id of the composed annotation [method] carries, among this api's. */
    Optional<String> operationOf(Method method) {
        for (Map.Entry<String, Class<? extends Annotation>> entry : binding.annotations().entrySet()) {
            if (AnnotatedElementUtils.hasAnnotation(method, entry.getValue())) return Optional.of(entry.getKey());
        }

        return Optional.empty();
    }

    /** `responses` of an operation: its property, then the api's property, then the target option. */
    boolean isStrict(String operationId) {
        String api = "seampact." + apiId();
        String mode = environment.getProperty(api + ".operations." + operationId + ".responses",
                environment.getProperty(api + ".responses", table.settings().path("responses").asString(STRICT)));

        if (!mode.equals(STRICT) && !mode.equals(WARN)) {
            throw new IllegalStateException("seampact: '" + api + ".responses' is '" + mode + "'; use 'strict' or 'warn'");
        }

        return mode.equals(STRICT);
    }

    boolean validatesBodies() {
        return environment.getProperty("seampact." + apiId() + ".body-validation", Boolean.class,
                table.settings().path("bodyValidation").asBoolean(false));
    }

    RequestView requestView(HttpServletRequest request, BoundaryExchange exchange) {
        Map<String, List<String>> headers = new LinkedHashMap<>();
        for (String name : Collections.list(request.getHeaderNames())) {
            headers.put(name.toLowerCase(Locale.ROOT), Collections.list(request.getHeaders(name)));
        }

        return new RequestView(request.getMethod(), exchange.contractPath, headers, Optional.ofNullable(request.getRemoteAddr()));
    }

    OperationRef operationRef(ContractRoute route) {
        return new OperationRef(apiId(), route.id());
    }

    /** Writes a refusal of the operation's codes; a code it does not list is the api's 500. */
    void writeRefusal(BoundaryExchange exchange, ContractRefusal refusal) {
        ContractRoute route = exchange.route();
        if (route.statusOf(refusal.code()).isEmpty()) {
            writeUnexpected(exchange, "the code '" + refusal.code() + "' is not one the operation lists", null);
            return;
        }

        writeError(exchange.response, route, refusal.code(), refusal.params());
        exchange.boundaryWrote = true;
    }

    /** Replaces whatever was written with the api's 500 and calls `onUnexpectedError`. */
    void writeUnexpected(BoundaryExchange exchange, String reason, Throwable cause) {
        exchange.response.discard();
        ContractRoute route = exchange.route();
        Optional<String> code = route.codeOfRole(UNDECLARED_STATUS_ROLE).or(() -> route.codeOfStatus(INTERNAL_ERROR));

        if (code.isPresent()) {
            writeError(exchange.response, route, code.get(), MissingNode.getInstance());
        } else {
            exchange.response.setStatus(INTERNAL_ERROR);
        }

        exchange.boundaryWrote = true;
        report(Optional.of(route.id()), reason, cause);
    }

    void writeError(HttpServletResponse response, ContractRoute route, String code, JsonNode params) {
        int status = route.statusOf(code).orElseThrow();
        byte[] body = mapper.writeValueAsBytes(ErrorReplies.body(table, route, code, params));

        response.setStatus(status);
        response.setContentType(ErrorReplies.media(table, route));
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        try {
            response.getOutputStream().write(body);
        } catch (IOException failure) {
            throw new IllegalStateException("seampact: writing the error reply of '" + code + "' failed", failure);
        }
    }

    /** Calls every `onUnexpectedError` bean, or logs the failure when the app registers none. */
    void report(Optional<String> operationId, String reason, Throwable cause) {
        Throwable unwrapped = cause instanceof ServletException wrapped && wrapped.getCause() != null ? wrapped.getCause() : cause;
        UnexpectedErrorListener.UnexpectedFailure failure =
                new UnexpectedErrorListener.UnexpectedFailure(apiId(), operationId, reason, Optional.ofNullable(unwrapped));
        List<UnexpectedErrorListener> listeners = new ArrayList<>(beans.getBeansOfType(UnexpectedErrorListener.class).values());

        if (listeners.isEmpty()) {
            LOG.error("seampact: unexpected failure in {}.{}: {}", apiId(), operationId.orElse("(none)"), reason, unwrapped);
            return;
        }

        listeners.forEach(listener -> listener.onUnexpectedError(failure));
    }

    JsonNode paramsOf(Throwable exception) {
        try {
            Method params = exception.getClass().getMethod("params");
            return mapper.valueToTree(params.invoke(exception));
        } catch (NoSuchMethodException noParams) {
            return MissingNode.getInstance();
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("seampact: reading the params of " + exception.getClass().getName() + " failed", failure);
        }
    }
}
