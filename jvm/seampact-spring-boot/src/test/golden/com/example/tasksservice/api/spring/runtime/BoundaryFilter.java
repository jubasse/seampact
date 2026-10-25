package com.example.tasksservice.api.spring.runtime;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.springframework.web.cors.CorsUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.MissingNode;

/**
 * Step 1 of the check order (ADR 0022 "Placement"), ordered before Spring Security and Boot's request-wrapper
 * filters: the raw-path match, the api's 404 for the paths under its base paths that no route serves, the media type
 * and the bounded body read; then it wraps the response in the checking wrapper and gives the verdict once the last
 * dispatch returns. An exception that escapes the chain is the api's 500, never the container's error page.
 */
public final class BoundaryFilter implements Filter {
    /** The order before Boot's request-wrapper filters (`-10000`) and Spring Security's chain (`-100`). */
    public static final int ORDER = -10001;

    private static final String CONTENT_TYPE = "Content-Type";
    private static final String PAYLOAD_TOO_LARGE_ROLE = "payloadTooLarge";
    private static final String UNSUPPORTED_MEDIA_TYPE_ROLE = "unsupportedMediaType";
    private static final String SCHEMA_INVALID_ROLE = "schemaInvalid";

    private final SeampactBoundary boundary;

    public BoundaryFilter(SeampactBoundary boundary) {
        this.boundary = boundary;
    }

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse, FilterChain chain) throws IOException, ServletException {
        if (!(servletRequest instanceof HttpServletRequest request) || !(servletResponse instanceof HttpServletResponse response)) {
            chain.doFilter(servletRequest, servletResponse);
            return;
        }

        if (request.getDispatcherType() == DispatcherType.ASYNC) {
            continueAsync(request, response, chain);
            return;
        }

        // A CORS preflight is the app's CORS setup's to answer (ADR 0022 "Routes").
        Optional<String> contractPath = boundary.contractPathOf(request).filter(boundary.table()::isUnderBasePath);
        if (contractPath.isEmpty() || CorsUtils.isPreFlightRequest(request)) {
            chain.doFilter(request, response);
            return;
        }

        Optional<ContractTable.RouteMatch> match = boundary.table().match(request.getMethod(), contractPath.get());
        if (match.isEmpty()) {
            answerUnserved(request, response, chain, contractPath.get());
            return;
        }

        boolean stripEtag = !"keep".equals(boundary.table().settings().path("frameworkEtag").asString("strip"));
        BoundaryExchange exchange = new BoundaryExchange(match.get(), contractPath.get(), new CheckingResponse(response, stripEtag));
        boundary.attach(request, exchange);

        runChain(request, exchange, chain);
        if (!request.isAsyncStarted()) OutgoingCheck.finish(boundary, exchange);
    }

    private void runChain(HttpServletRequest request, BoundaryExchange exchange, FilterChain chain) {
        try {
            HttpServletRequest forwarded = readInput(request, exchange);
            chain.doFilter(forwarded, exchange.response);
        } catch (ContractRefusal refusal) {
            boundary.writeRefusal(exchange, refusal);
        } catch (IOException | ServletException | RuntimeException failure) {
            boundary.writeUnexpected(exchange, "an exception escaped the handler chain", failure);
        }
    }

    private void continueAsync(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        Optional<BoundaryExchange> exchange = boundary.exchangeOf(request);
        if (exchange.isEmpty()) {
            chain.doFilter(request, response);
            return;
        }

        try {
            chain.doFilter(request, exchange.get().response);
        } catch (IOException | ServletException | RuntimeException failure) {
            boundary.writeUnexpected(exchange.get(), "an exception escaped the asynchronous dispatch", failure);
        }
        if (!request.isAsyncStarted()) OutgoingCheck.finish(boundary, exchange.get());
    }

    // A path under a base path that no route serves with this method: the api's 404 under `catchAll`, else the app's.
    private void answerUnserved(HttpServletRequest request, HttpServletResponse response, FilterChain chain, String path) throws IOException, ServletException {
        boolean catchAll = boundary.table().settings().path("catchAll").asBoolean(true);
        Optional<ContractRoute> route = boundary.table().notFoundRoute(path);
        if (!catchAll || route.isEmpty()) {
            chain.doFilter(request, response);
            return;
        }

        String code = route.get().codeOfRole(ContractTable.NOT_FOUND_ROLE).orElseThrow();
        boundary.writeError(response, route.get(), code, MissingNode.getInstance());
    }

    // The media type and the bounded body read, for an operation with an input body.
    private HttpServletRequest readInput(HttpServletRequest request, BoundaryExchange exchange) throws IOException {
        JsonNode input = exchange.route().operation().path("input");
        if (input.isMissingNode()) return request;

        long limitBytes = input.path("bodyLimitBytes").asLong();
        byte[] body;
        try {
            body = BodyReader.read(request, limitBytes);
        } catch (BodyReader.BodyRefusedException refused) {
            throw refusalOf(exchange.route(), refused.reason(), limitBytes);
        }

        if (body.length > 0) {
            if (!mediaMatches(request.getHeader(CONTENT_TYPE), input.path("media").asString())) {
                throw new ContractRefusal(roleCode(exchange.route(), UNSUPPORTED_MEDIA_TYPE_ROLE), MissingNode.getInstance());
            }
            exchange.body = body;
        }

        return new HeldBodyRequest(request, body);
    }

    private static boolean mediaMatches(String contentType, String media) {
        if (contentType == null) return false;

        return contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT).equals(media);
    }

    private static ContractRefusal refusalOf(ContractRoute route, BodyReader.Refused reason, long limitBytes) {
        return switch (reason) {
            case TOO_LARGE -> {
                String code = roleCode(route, PAYLOAD_TOO_LARGE_ROLE);
                yield new ContractRefusal(code, ErrorReplies.roleParams(route.roleParams(code, PAYLOAD_TOO_LARGE_ROLE),
                        Map.of("limitBytes", JsonNodeFactory.instance.numberNode(limitBytes))));
            }
            case UNSUPPORTED_CODING -> new ContractRefusal(roleCode(route, UNSUPPORTED_MEDIA_TYPE_ROLE), MissingNode.getInstance());
            case CORRUPT -> InputStep.schemaInvalid(route, List.of(new InputIssue("body", "", "type")));
        };
    }

    static String roleCode(ContractRoute route, String role) {
        return route.codeOfRole(role).orElseThrow(() -> new IllegalStateException(
                "seampact: the operation '" + route.id() + "' lists no code for the role '" + role + "'"));
    }
}
