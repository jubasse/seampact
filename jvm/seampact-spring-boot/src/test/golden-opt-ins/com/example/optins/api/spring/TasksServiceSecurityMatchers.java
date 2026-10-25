package com.example.optins.api.spring;

import org.springframework.http.HttpMethod;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

/**
 * The routes of the api 'tasksService' by access kind, for the app's own Spring Security rules, under the servlet path.
 */
public final class TasksServiceSecurityMatchers {
    private final RequestMatcher publicRoutes;

    private final RequestMatcher optionalRoutes;

    private final RequestMatcher anonymousOnRefusalRoutes;

    private final RequestMatcher identityRoutes;

    private final RequestMatcher signedRoutes;

    public TasksServiceSecurityMatchers(String servletPath) {
        PathPatternRequestMatcher.Builder routes = PathPatternRequestMatcher.withDefaults();
        if (!servletPath.isEmpty() && !servletPath.equals("/")) {
            routes = routes.basePath(servletPath);
        }
        this.publicRoutes = anyOf(routes.matcher(HttpMethod.GET, "/internal/v1/{p1}/{p2}/tasks/{p3}"), routes.matcher(HttpMethod.HEAD, "/internal/v1/{p1}/{p2}/tasks/{p3}"));
        this.optionalRoutes = anyOf(routes.matcher(HttpMethod.GET, "/internal/v1/channels/{p1}/peeks/{p2}"), routes.matcher(HttpMethod.HEAD, "/internal/v1/channels/{p1}/peeks/{p2}"));
        this.anonymousOnRefusalRoutes = anyOf(routes.matcher(HttpMethod.GET, "/internal/v1/channels/{p1}/peeks/{p2}"), routes.matcher(HttpMethod.HEAD, "/internal/v1/channels/{p1}/peeks/{p2}"));
        this.identityRoutes = anyOf(routes.matcher(HttpMethod.GET, "/internal/v1/channels/{p1}/tasks/{p2}"), routes.matcher(HttpMethod.HEAD, "/internal/v1/channels/{p1}/tasks/{p2}"));
        this.signedRoutes = anyOf(routes.matcher(HttpMethod.GET, "/internal/v1/channels/{p1}/signed/{p2}"), routes.matcher(HttpMethod.HEAD, "/internal/v1/channels/{p1}/signed/{p2}"));
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

    private static RequestMatcher anyOf(RequestMatcher... matchers) {
        if (matchers.length == 0) return request -> false;
        return new OrRequestMatcher(matchers);
    }
}
