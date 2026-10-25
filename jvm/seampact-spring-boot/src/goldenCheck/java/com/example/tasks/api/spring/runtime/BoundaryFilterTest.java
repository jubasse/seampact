package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.tasks.api.spring.TasksContractTable;
import com.example.tasks.api.spring.TasksSeampactBinding;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.node.MissingNode;

/**
 * The boundary filter of the golden 'tasks' api on mock requests, with chains standing for what Spring and the app
 * run inside it (ADR 0022 "Routes" and "The outgoing response check").
 */
class BoundaryFilterTest {
    private static final String HEALTH_PATH = "/v1/health";
    private static final String TASK_PATH = "/v1/channels/c1/tasks/t1";
    private static final String NOT_FOUND_CODE = "api.not_found";
    private static final String INTERNAL_CODE = "\"code\":\"api.internal\"";
    private static final int INTERNAL_ERROR = 500;
    private static final int NOT_FOUND = 404;
    private static final int UNDECLARED_STATUS = 299;
    private static final int MOVED_PERMANENTLY = 301;

    private final List<UnexpectedErrorListener.UnexpectedFailure> reported = new ArrayList<>();
    private final SeampactBoundary boundary = boundaryReportingTo(reported);

    private static SeampactBoundary boundaryReportingTo(List<UnexpectedErrorListener.UnexpectedFailure> reported) {
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        UnexpectedErrorListener listener = reported::add;
        beans.addBean("unexpectedFailures", listener);

        return new SeampactBoundary(TasksContractTable.json(), new TasksSeampactBinding(), beans, new StandardEnvironment());
    }

    private MockHttpServletResponse serve(MockHttpServletRequest request, FilterChain chain) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        new BoundaryFilter(boundary).doFilter(request, response, chain);

        return response;
    }

    // A refusal the boundary writes, as the interceptor does for a task it does not find.
    private void writeNotFoundRefusal(HttpServletRequest request) {
        BoundaryExchange exchange = boundary.exchangeOf(request).orElseThrow();
        boundary.writeRefusal(exchange, new ContractRefusal(NOT_FOUND_CODE, MissingNode.getInstance()));
    }

    private void assertReplacedByInternalError(MockHttpServletResponse response) throws Exception {
        assertEquals(INTERNAL_ERROR, response.getStatus());
        assertTrue(response.getContentAsString().contains(INTERNAL_CODE), response.getContentAsString());
        assertEquals(1, reported.size(), "onUnexpectedError is called once");
    }

    @Test
    void statusChangedAfterTheBoundaryWroteIsAViolation() throws Exception {
        MockHttpServletResponse response = serve(new MockHttpServletRequest("GET", TASK_PATH), (request, reply) -> {
            writeNotFoundRefusal((HttpServletRequest) request);
            ((HttpServletResponse) reply).setStatus(UNDECLARED_STATUS);
        });

        assertReplacedByInternalError(response);
    }

    @Test
    void bytesAppendedAfterTheBoundaryWroteAreAViolation() throws Exception {
        MockHttpServletResponse response = serve(new MockHttpServletRequest("GET", TASK_PATH), (request, reply) -> {
            writeNotFoundRefusal((HttpServletRequest) request);
            reply.getOutputStream().write("GARBAGE".getBytes(StandardCharsets.UTF_8));
        });

        assertReplacedByInternalError(response);
    }

    @Test
    void redirectWithStatusIsHeldAndCheckedLikeAnyReply() throws Exception {
        MockHttpServletResponse response = serve(new MockHttpServletRequest("GET", HEALTH_PATH),
                (request, reply) -> ((HttpServletResponse) reply).sendRedirect("/elsewhere", MOVED_PERMANENTLY, true));

        assertReplacedByInternalError(response);
    }

    @Test
    void corsPreflightOnAContractPathGoesToTheApp() throws Exception {
        MockHttpServletRequest preflight = new MockHttpServletRequest("OPTIONS", HEALTH_PATH);
        preflight.addHeader("Origin", "https://app.example");
        preflight.addHeader("Access-Control-Request-Method", "GET");
        List<HttpServletRequest> reachedApp = new ArrayList<>();

        MockHttpServletResponse response = serve(preflight, (request, reply) -> reachedApp.add((HttpServletRequest) request));

        assertEquals(1, reachedApp.size(), "the preflight reaches the app's CORS setup");
        assertEquals(HttpServletResponse.SC_OK, response.getStatus());
    }

    @Test
    void sendErrorWithAStatusOtherThan401403Or429IsAViolation() throws Exception {
        MockHttpServletResponse response = serve(new MockHttpServletRequest("GET", TASK_PATH),
                (request, reply) -> ((HttpServletResponse) reply).sendError(NOT_FOUND));

        assertReplacedByInternalError(response);
    }
}
