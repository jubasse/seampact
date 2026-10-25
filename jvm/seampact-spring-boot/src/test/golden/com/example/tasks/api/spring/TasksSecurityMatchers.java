package com.example.tasks.api.spring;

import org.springframework.http.HttpMethod;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

/**
 * The routes of the api 'tasks' by access kind, for the app's own Spring Security rules, under the servlet path.
 */
public final class TasksSecurityMatchers {
    private final RequestMatcher publicRoutes;

    private final RequestMatcher optionalRoutes;

    private final RequestMatcher anonymousOnRefusalRoutes;

    private final RequestMatcher identityRoutes;

    private final RequestMatcher signedRoutes;

    public TasksSecurityMatchers(String servletPath) {
        PathPatternRequestMatcher.Builder routes = PathPatternRequestMatcher.withDefaults();
        if (!servletPath.isEmpty() && !servletPath.equals("/")) {
            routes = routes.basePath(servletPath);
        }
        this.publicRoutes = anyOf(routes.matcher(HttpMethod.GET, "/v1/health"), routes.matcher(HttpMethod.HEAD, "/v1/health"));
        this.optionalRoutes = anyOf();
        this.anonymousOnRefusalRoutes = anyOf();
        this.identityRoutes = anyOf(routes.matcher(HttpMethod.POST, "/v1/channels/{p1}/tasks/{p2}/archive"), routes.matcher(HttpMethod.POST, "/v1/channels/{p1}/tasks/{p2}/assign"), routes.matcher(HttpMethod.POST, "/v1/channels/{p1}/tasks"), routes.matcher(HttpMethod.DELETE, "/v1/me/drafts/{p1}"), routes.matcher(HttpMethod.GET, "/v1/channels/{p1}"), routes.matcher(HttpMethod.HEAD, "/v1/channels/{p1}"), routes.matcher(HttpMethod.GET, "/v1/me/drafts/{p1}"), routes.matcher(HttpMethod.HEAD, "/v1/me/drafts/{p1}"), routes.matcher(HttpMethod.GET, "/v1/me/preferences"), routes.matcher(HttpMethod.HEAD, "/v1/me/preferences"), routes.matcher(HttpMethod.GET, "/v1/channels/{p1}/tasks/{p2}"), routes.matcher(HttpMethod.HEAD, "/v1/channels/{p1}/tasks/{p2}"), routes.matcher(HttpMethod.POST, "/v1/channels/{p1}/tasks/batch"), routes.matcher(HttpMethod.GET, "/v1/channels"), routes.matcher(HttpMethod.HEAD, "/v1/channels"), routes.matcher(HttpMethod.GET, "/v1/channels/{p1}/tasks"), routes.matcher(HttpMethod.HEAD, "/v1/channels/{p1}/tasks"), routes.matcher(HttpMethod.POST, "/v1/channels/{p1}/tasks/{p2}/purge"), routes.matcher(HttpMethod.POST, "/v1/channels/{p1}/tasks/search"), routes.matcher(HttpMethod.PATCH, "/v1/me/preferences"), routes.matcher(HttpMethod.PATCH, "/v1/channels/{p1}/tasks/{p2}"));
        this.signedRoutes = anyOf(routes.matcher(HttpMethod.POST, "/v1/hooks/payments"));
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
