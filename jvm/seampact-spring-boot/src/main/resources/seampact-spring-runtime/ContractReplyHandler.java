package io.github.jubasse.seampact.springboot.runtime;

import io.github.jubasse.seampact.hooks.RequestView;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.lang.reflect.RecordComponent;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import org.springframework.core.MethodParameter;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodReturnValueHandler;
import org.springframework.web.method.support.ModelAndViewContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.MissingNode;
import tools.jackson.databind.node.NullNode;

/**
 * Step 10's writer (ADR 0022 "The reply path"), first in Spring's list: it writes the value a contract method
 * returns with the boundary's own mapper, after the restricted output fields, never through content negotiation.
 */
public final class ContractReplyHandler implements HandlerMethodReturnValueHandler {
    private static final String BODY = "body";
    private static final String PARAMS = "params";
    private static final String ITEMS = "items";
    private static final String TOTAL = "total";
    private static final String PAGE_SHAPE = "page";
    private static final String EMPTY_SHAPE = "empty";
    private static final int NO_CONTENT = 204;

    private final SeampactBoundary boundary;

    public ContractReplyHandler(SeampactBoundary boundary) {
        this.boundary = boundary;
    }

    @Override
    public boolean supportsReturnType(MethodParameter returnType) {
        return returnType.getMethod() != null && boundary.operationOf(returnType.getMethod()).isPresent();
    }

    @Override
    public void handleReturnValue(Object value, MethodParameter returnType, ModelAndViewContainer container, NativeWebRequest webRequest) throws IOException {
        container.setRequestHandled(true);
        HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
        BoundaryExchange exchange = request == null ? null : boundary.exchangeOf(request).orElse(null);
        if (exchange == null) {
            throw new IllegalStateException("seampact: a contract method returned outside a contract route of the api '" + boundary.apiId() + "'");
        }

        if (value == null) {
            exchange.violation = Optional.of("the handler returned null");
            return;
        }

        Integer status = boundary.binding().successArms().get(value.getClass());
        if (status != null) {
            writeSuccess(exchange, request, status, component(value, BODY));
            return;
        }

        String code = boundary.binding().errorArms().get(value.getClass());
        if (code == null) {
            exchange.violation = Optional.of("the handler returned " + value.getClass().getName() + ", not an arm of its result");
            return;
        }

        Object params = component(value, PARAMS);
        boundary.writeRefusal(exchange, new ContractRefusal(code, params == null ? MissingNode.getInstance() : boundary.mapper().valueToTree(params)));
    }

    private void writeSuccess(BoundaryExchange exchange, HttpServletRequest request, int status, Object bodyValue) throws IOException {
        JsonNode response = exchange.route().response(status);
        CheckingResponse checking = exchange.response;

        // A null body is the format's null, as on the PHP and Node targets: its schema decides whether it may be null.
        if (hasBody(response, status)) {
            boolean isPage = PAGE_SHAPE.equals(response.path("shape").asString());
            if (isPage && bodyValue == null) {
                exchange.violation = Optional.of("the handler returned a null page");
                return;
            }

            JsonNode handlerBody = bodyValue == null
                    ? NullNode.getInstance()
                    : boundary.mapper().valueToTree(isPage ? boundary.binding().pageFacts(bodyValue) : bodyValue);
            JsonNode payload = isPage ? handlerBody.path(ITEMS) : handlerBody;
            if (isPage && !payload.isArray()) {
                exchange.violation = Optional.of("the handler returned a page without items");
                return;
            }
            if (isPage && handlerBody.path(TOTAL).asLong(0) < 0) {
                exchange.violation = Optional.of("the handler returned a page whose total is negative");
                return;
            }

            RequestView view = boundary.requestView(request, exchange);
            OutputFieldRights.apply(boundary, exchange, view, response, payload);

            Optional<String> broken = brokenSchema(response, payload);
            if (broken.isPresent()) {
                exchange.violation = broken;
                return;
            }

            JsonNode body;
            if (isPage) {
                PageReply.RenderedPage page = PageReply.render(boundary.table(), exchange, request.getQueryString(), request.getRequestURI(), boundary.publicOrigin(), handlerBody, payload, status);
                page.headers().forEach(header -> checking.addHeader(header.getKey(), header.getValue()));
                body = page.body();
            } else {
                body = SuccessEnvelope.body(boundary.table().format(exchange.route()), response.path("shape").asString(), payload, status, request.getRequestURI());
            }

            byte[] bodyBytes = boundary.mapper().writeValueAsBytes(body);
            if (CacheHeaders.write(exchange, request, checking, bodyBytes)) {
                checking.setStatus(CacheHeaders.NOT_MODIFIED);
                exchange.markBoundaryWrote();
                return;
            }

            checking.setContentType(response.path("media").asString());
            checking.setCharacterEncoding(StandardCharsets.UTF_8.name());
            checking.getOutputStream().write(bodyBytes);
        }

        checking.setStatus(status);
        exchange.markBoundaryWrote();
    }

    private static boolean hasBody(JsonNode response, int status) {
        return status != NO_CONTENT && !EMPTY_SHAPE.equals(response.path("shape").asString());
    }

    // The success body against its schema when the api checks bodies; a list's, a table's and a page's every item.
    private Optional<String> brokenSchema(JsonNode response, JsonNode payload) {
        if (!boundary.validatesBodies()) return Optional.empty();

        for (JsonNode instance : OutputFieldRights.schemaInstances(payload, response.path("shape").asString())) {
            List<InputIssue> issues = boundary.validator().issuesOf(instance, response.path("body"), "body", "");
            if (!issues.isEmpty()) {
                return Optional.of("the success body breaks its schema at " + issues.get(0).pointer() + " (" + issues.get(0).rule() + ")");
            }
        }

        return Optional.empty();
    }

    // A result arm's record component, null when the arm has none (a 204, a code without params).
    private static Object component(Object arm, String name) {
        RecordComponent[] components = arm.getClass().getRecordComponents();
        if (components == null) return null;

        for (RecordComponent component : components) {
            if (!component.getName().equals(name)) continue;
            try {
                return component.getAccessor().invoke(arm);
            } catch (ReflectiveOperationException failure) {
                throw new IllegalStateException("seampact: reading '" + name + "' of " + arm.getClass().getName() + " failed", failure);
            }
        }

        return null;
    }
}
