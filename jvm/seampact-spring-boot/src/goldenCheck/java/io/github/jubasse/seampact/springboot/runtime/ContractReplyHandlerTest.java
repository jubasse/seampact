package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

import com.example.tasks.api.HealthResult;
import com.example.tasks.api.ListTasksResult;
import com.example.tasks.api.TasksUnexpectedErrorListener;
import com.example.tasks.api.spring.TasksContractTable;
import com.example.tasks.api.spring.TasksSeampactBinding;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.Environment;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.method.support.ModelAndViewContainer;

/** The reply a handler's success arm gets on the golden 'tasks' api (ADR 0022 "The reply path"). */
class ContractReplyHandlerTest {
    private static final String HEALTH_PATH = "/v1/health";
    private static final String TASKS_PATH = "/v1/channels/c1/tasks";
    private static final String BODY_VALIDATION = "seampact.tasks.body-validation";
    private static final int OK = 200;
    private static final int INTERNAL_ERROR = 500;

    private static MockHttpServletResponse answer(Environment environment, String path, Object result) throws Exception {
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        TasksUnexpectedErrorListener ignoreFailures = failure -> { };
        beans.addBean("unexpectedFailures", ignoreFailures);
        SeampactBoundary boundary = new SeampactBoundary(TasksContractTable.json(), new TasksSeampactBinding(), beans, environment);

        MockHttpServletResponse response = new MockHttpServletResponse();
        new BoundaryFilter(boundary).doFilter(new MockHttpServletRequest("GET", path), response, (request, reply) ->
                new ContractReplyHandler(boundary).handleReturnValue(result, null, new ModelAndViewContainer(),
                        new ServletWebRequest((HttpServletRequest) request, (HttpServletResponse) reply)));

        return response;
    }

    @Test
    void aNullBodyAnswersTheBareFormatsNull() throws Exception {
        MockHttpServletResponse response = answer(new MockEnvironment(), HEALTH_PATH, new HealthResult.Status200(null));

        assertEquals(OK, response.getStatus());
        assertEquals("null", response.getContentAsString());
        assertEquals("application/json", response.getContentType().split(";")[0]);
    }

    @Test
    void aNullBodyThatBreaksItsSchemaIsAViolationUnderBodyValidation() throws Exception {
        MockHttpServletResponse response = answer(new MockEnvironment().withProperty(BODY_VALIDATION, "true"), HEALTH_PATH, new HealthResult.Status200(null));

        assertEquals(INTERNAL_ERROR, response.getStatus());
    }

    @Test
    void aBodyThatBreaksItsSchemaGoesOutAsWrittenAndIsLoggedUnderWarn() throws Exception {
        Logger seampactLog = (Logger) LoggerFactory.getLogger("seampact");
        ListAppender<ILoggingEvent> logged = new ListAppender<>();
        logged.start();
        seampactLog.addAppender(logged);

        try {
            MockEnvironment warn = new MockEnvironment().withProperty(BODY_VALIDATION, "true").withProperty("seampact.tasks.responses", "warn");
            MockHttpServletResponse response = answer(warn, HEALTH_PATH, new HealthResult.Status200(null));

            assertEquals(OK, response.getStatus());
            assertEquals("null", response.getContentAsString());
            assertTrue(logged.list.stream().anyMatch(event -> event.getFormattedMessage().contains("breaks its schema")));
        } finally {
            seampactLog.detachAppender(logged);
        }
    }

    @Test
    void aNullPageIsAViolation() throws Exception {
        MockHttpServletResponse response = answer(new MockEnvironment(), TASKS_PATH, new ListTasksResult.Status200(null));

        assertEquals(INTERNAL_ERROR, response.getStatus());
    }
}
