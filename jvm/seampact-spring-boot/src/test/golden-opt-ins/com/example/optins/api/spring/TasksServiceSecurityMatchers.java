package com.example.optins.api.spring;

import io.github.jubasse.seampact.springboot.runtime.SeampactBoundary;
import java.util.Set;
import org.springframework.security.web.util.matcher.RequestMatcher;

/**
 * The routes of the api 'tasksService' by access kind, for the app's own Spring Security rules: each matches the operation the
 * boundary filter matched, so it needs that filter before Spring Security's chain, as the boot check makes sure.
 */
public final class TasksServiceSecurityMatchers {
    private final RequestMatcher publicRoutes;

    private final RequestMatcher optionalRoutes;

    private final RequestMatcher anonymousOnRefusalRoutes;

    private final RequestMatcher identityRoutes;

    private final RequestMatcher signedRoutes;

    public TasksServiceSecurityMatchers(SeampactBoundary boundary) {
        this.publicRoutes = operations(boundary, Set.of("browseTask"));
        this.optionalRoutes = operations(boundary, Set.of("peekTask"));
        this.anonymousOnRefusalRoutes = operations(boundary, Set.of("peekTask"));
        this.identityRoutes = operations(boundary, Set.of("getTask"));
        this.signedRoutes = operations(boundary, Set.of("signTask"));
    }

    /**
     * Matches the public operations.
     */
    public RequestMatcher publicRoutes() {
        return publicRoutes;
    }

    /**
     * Matches the optional-auth operations.
     */
    public RequestMatcher optionalRoutes() {
        return optionalRoutes;
    }

    /**
     * Matches the optional-auth operations whose refused credentials call anonymously.
     */
    public RequestMatcher anonymousOnRefusalRoutes() {
        return anonymousOnRefusalRoutes;
    }

    /**
     * Matches the operations that need a credential identity.
     */
    public RequestMatcher identityRoutes() {
        return identityRoutes;
    }

    /**
     * Matches the operations a signed identity calls.
     */
    public RequestMatcher signedRoutes() {
        return signedRoutes;
    }

    private static RequestMatcher operations(SeampactBoundary boundary, Set<String> operationIds) {
        return request -> boundary.operationIdOf(request).filter(operationIds::contains).isPresent();
    }
}
