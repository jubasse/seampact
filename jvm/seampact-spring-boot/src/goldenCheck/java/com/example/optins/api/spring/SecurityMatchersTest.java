package com.example.optins.api.spring;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.optins.api.TasksServiceUnexpectedErrorListener;
import io.github.jubasse.seampact.springboot.runtime.BoundaryFilter;
import io.github.jubasse.seampact.springboot.runtime.SeampactBoundary;
import io.github.jubasse.seampact.springboot.runtime.SecurityRefusals;
import jakarta.servlet.FilterChain;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockServletContext;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;

/**
 * The generated Spring Security beans of the opt-ins api in a real Spring Security chain, behind the boundary filter:
 * the customizer permits the public, optional-auth and signed routes, and the app's own rules (a role on the identity
 * routes, then any request authenticated) hold on every other route, whichever route template also covers it; the
 * generated refusals, wired in the app's chain, answer Spring Security's refusals on the api's routes in its format.
 */
class SecurityMatchersTest {
    private static final String IDENTITY_LITERAL_PATH = "/internal/v1/channels/c1/tasks/t1";
    private static final String PUBLIC_TEMPLATE_PATH = "/internal/v1/teams/c1/tasks/t1";
    private static final String OPTIONAL_PATH = "/internal/v1/channels/c1/peeks/t1";
    private static final String SIGNED_PATH = "/internal/v1/channels/c1/signed/t1";
    private static final String APP_PATH = "/actuator/info";
    private static final String UNAUTHENTICATED_CODE = "\"api.unauthenticated\"";
    private static final String FORBIDDEN_CODE = "\"api.forbidden\"";

    private final SeampactBoundary boundary = boundary();
    private final AnnotationConfigWebApplicationContext context = securityContext(boundary);

    @Configuration(proxyBeanMethods = false)
    @EnableWebSecurity
    static class AppSecurity {
        @Bean
        SecurityFilterChain appChain(HttpSecurity http, TasksServiceSecurityMatchers matchers, SecurityRefusals refusals)
                throws Exception {
            return http
                    .authorizeHttpRequests(authorize -> authorize
                            .requestMatchers(matchers.identityRoutes()).hasRole("OPERATOR")
                            .anyRequest().authenticated())
                    .exceptionHandling(refusing -> refusing.authenticationEntryPoint(refusals).accessDeniedHandler(refusals))
                    .build();
        }
    }

    private static SeampactBoundary boundary() {
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        TasksServiceUnexpectedErrorListener listener = failure -> { };
        beans.addBean("unexpectedFailures", listener);

        return new SeampactBoundary(TasksServiceContractTable.json(), new TasksServiceSeampactBinding(), beans, new StandardEnvironment());
    }

    private static AnnotationConfigWebApplicationContext securityContext(SeampactBoundary boundary) {
        AnnotationConfigWebApplicationContext context = new AnnotationConfigWebApplicationContext();
        context.setServletContext(new MockServletContext());
        context.addBeanFactoryPostProcessor(beanFactory -> beanFactory.registerSingleton("tasksServiceSeampactBoundary", boundary));
        context.register(AppSecurity.class, TasksServiceSecurityConfiguration.class);
        context.refresh();

        return context;
    }

    @AfterEach
    void closeContext() {
        context.close();
    }

    private record Exchange(boolean served, MockHttpServletResponse response) { }

    // A request sent by `caller` through the boundary filter and Spring Security's chain.
    private Exchange send(String method, String path, Caller caller) throws Exception {
        AtomicBoolean served = new AtomicBoolean();
        FilterChain handler = (request, response) -> served.set(true);
        FilterChainProxy securityChain = context.getBean(FilterChainProxy.class);
        FilterChain throughSecurity = (request, response) -> securityChain.doFilter(request, response, handler);

        MockHttpServletRequest request = new MockHttpServletRequest(context.getServletContext(), method, path);
        if (caller == Caller.SIGNED_IN_WITHOUT_ROLE) {
            SecurityContextImpl signedIn = new SecurityContextImpl(UsernamePasswordAuthenticationToken.authenticated("ops", null, List.of()));
            request.getSession(true).setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, signedIn);
        }

        MockHttpServletResponse response = new MockHttpServletResponse();
        new BoundaryFilter(boundary).doFilter(request, response, throughSecurity);

        return new Exchange(served.get(), response);
    }

    private enum Caller { ANONYMOUS, SIGNED_IN_WITHOUT_ROLE }

    private boolean reachesTheHandler(String method, String path) throws Exception {
        return send(method, path, Caller.ANONYMOUS).served();
    }

    @Test
    void anIdentityLiteralBesideAPublicTemplateKeepsTheAppsRules() throws Exception {
        assertFalse(reachesTheHandler("GET", IDENTITY_LITERAL_PATH), "the public template does not permit the identity literal");
        assertFalse(reachesTheHandler("HEAD", IDENTITY_LITERAL_PATH), "HEAD reaches the identity operation too");
    }

    @Test
    void thePublicTemplateIsPermitted() throws Exception {
        assertTrue(reachesTheHandler("GET", PUBLIC_TEMPLATE_PATH));
    }

    @Test
    void theOptionalAuthRouteIsPermitted() throws Exception {
        assertTrue(reachesTheHandler("GET", OPTIONAL_PATH));
    }

    @Test
    void theSignedRouteIsPermittedForTheBoundaryToCheckItsSignature() throws Exception {
        assertTrue(reachesTheHandler("GET", SIGNED_PATH));
    }

    @Test
    void anAppRouteKeepsTheAppsRules() throws Exception {
        assertFalse(reachesTheHandler("GET", APP_PATH));
    }

    @Test
    void theEntryPointAnswersAnAnonymousCallerWithTheOperationsUnauthenticatedCode() throws Exception {
        MockHttpServletResponse response = send("GET", IDENTITY_LITERAL_PATH, Caller.ANONYMOUS).response();

        assertEquals(401, response.getStatus());
        assertTrue(response.getContentAsString().contains(UNAUTHENTICATED_CODE), response.getContentAsString());
    }

    @Test
    void theAccessDeniedHandlerAnswersACallerWithoutTheRoleWithTheOperationsForbiddenCode() throws Exception {
        MockHttpServletResponse response = send("GET", IDENTITY_LITERAL_PATH, Caller.SIGNED_IN_WITHOUT_ROLE).response();

        assertEquals(403, response.getStatus());
        assertTrue(response.getContentAsString().contains(FORBIDDEN_CODE), response.getContentAsString());
    }

    @Test
    void aRefusalOutsideTheApisRoutesKeepsSpringSecuritysDefault() throws Exception {
        MockHttpServletResponse response = send("GET", APP_PATH, Caller.ANONYMOUS).response();

        assertEquals(401, response.getStatus());
        assertEquals("", response.getContentAsString());
    }
}
