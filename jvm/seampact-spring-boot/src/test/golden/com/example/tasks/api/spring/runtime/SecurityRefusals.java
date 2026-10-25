package com.example.tasks.api.spring.runtime;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.CsrfException;

/**
 * Spring Security's refusals in the api's format (ADR 0022 "Native security layers"): the entry point answers the
 * `unauthenticated` role, the access-denied handler the `forbidden` role, or `csrfInvalid` for a CSRF refusal, each
 * with the code of the operation the request matched. Outside the api's routes they answer as Spring Security's
 * defaults do, with `sendError`. Copied only when the Spring Security beans are generated.
 */
public final class SecurityRefusals implements AuthenticationEntryPoint, AccessDeniedHandler {
    private static final String UNAUTHENTICATED_ROLE = "unauthenticated";
    private static final String FORBIDDEN_ROLE = "forbidden";
    private static final String CSRF_INVALID_ROLE = "csrfInvalid";

    private final SeampactBoundary boundary;

    public SecurityRefusals(SeampactBoundary boundary) {
        this.boundary = boundary;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException refusal) throws IOException {
        answer(request, response, UNAUTHENTICATED_ROLE, HttpServletResponse.SC_UNAUTHORIZED, refusal);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException refusal) throws IOException {
        String role = refusal instanceof CsrfException ? CSRF_INVALID_ROLE : FORBIDDEN_ROLE;
        answer(request, response, role, HttpServletResponse.SC_FORBIDDEN, refusal);
    }

    private void answer(HttpServletRequest request, HttpServletResponse response, String role, int defaultStatus, RuntimeException refusal)
            throws IOException {
        Optional<BoundaryExchange> exchange = boundary.exchangeOf(request);
        if (exchange.isEmpty()) {
            response.sendError(defaultStatus);
            return;
        }

        boundary.writeRoleRefusal(exchange.get(), role, refusal);
    }
}
