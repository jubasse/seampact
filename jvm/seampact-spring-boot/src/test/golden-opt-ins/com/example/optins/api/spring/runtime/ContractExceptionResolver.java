package com.example.optins.api.spring.runtime;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.Optional;
import org.springframework.web.servlet.HandlerExceptionResolver;
import org.springframework.web.servlet.ModelAndView;

/**
 * The first exception resolver (ADR 0022 "Exceptions on contract routes"): on a contract route it answers the
 * generated contract exceptions and Spring Security's refusals thrown inside the MVC dispatch, in the api's format.
 * It marks every other exception it sees and returns null, so the app's own handlers answer, checked afterwards.
 */
public final class ContractExceptionResolver implements HandlerExceptionResolver {
    private static final Map<String, String> SECURITY_ROLES = Map.of(
            "org.springframework.security.core.AuthenticationException", "unauthenticated",
            "org.springframework.security.web.csrf.CsrfException", "csrfInvalid",
            "org.springframework.security.access.AccessDeniedException", "forbidden");

    private final SeampactBoundary boundary;

    public ContractExceptionResolver(SeampactBoundary boundary) {
        this.boundary = boundary;
    }

    @Override
    public ModelAndView resolveException(HttpServletRequest request, HttpServletResponse response, Object handler, Exception exception) {
        Optional<BoundaryExchange> found = boundary.exchangeOf(request);
        if (found.isEmpty()) return null;

        BoundaryExchange exchange = found.get();
        exchange.exceptionSeen = true;

        Optional<String> code = boundary.binding().contractCode(exception);
        if (code.isPresent()) {
            boundary.writeRefusal(exchange, new ContractRefusal(code.get(), boundary.paramsOf(exception)));
            return new ModelAndView();
        }

        Optional<String> role = securityRole(exception);
        if (role.isEmpty()) return null;

        boundary.writeRoleRefusal(exchange, role.get(), exception);

        return new ModelAndView();
    }

    // The most specific class first: Spring Security's CsrfException is an AccessDeniedException.
    private static Optional<String> securityRole(Exception exception) {
        for (Class<?> type = exception.getClass(); type != null; type = type.getSuperclass()) {
            String role = SECURITY_ROLES.get(type.getName());
            if (role != null) return Optional.of(role);
        }

        return Optional.empty();
    }
}
