package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import jakarta.servlet.FilterChain;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import tools.jackson.databind.json.JsonMapper;

/** Spring Security's own CSRF refusal on a contract route, answered by `SecurityRefusals` in the api's format. */
class SecurityRefusalsTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    // A write operation that declares the `csrfInvalid` code, in a format that writes the code alone.
    private static final String TABLE = """
            {"api": {"id": "tasks"},
             "errors": {"api.csrf_invalid": {"code": "api.csrf_invalid", "family": "api", "nature": "refused",
               "http": {"status": 403}, "default": "csrfInvalid"}},
             "formats": {"bare": {"error": {"media": "application/json", "headers": [], "body": {"kind": "object",
               "members": [{"name": {"kind": "text", "text": "code"}, "value": {"kind": "slot", "slot": "code", "path": []}}]}}}},
             "operations": [{"id": "createTask", "method": "post", "path": "/tasks", "safe": false, "format": "bare",
               "errors": [{"code": "api.csrf_invalid"}]}]}
            """;

    @Test
    void aCsrfRefusalOfSpringSecurityIsTheOperationsCsrfInvalidCode() throws Exception {
        SeampactBoundary boundary = new SeampactBoundary(TABLE, new TasksTestBinding(Map.of()), new StaticListableBeanFactory(),
                new StandardEnvironment());
        ContractRoute createTask = boundary.table().routes().getFirst();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/tasks");
        CheckingResponse response = new CheckingResponse(new MockHttpServletResponse(), false);
        boundary.attach(request, new BoundaryExchange(new ContractTable.RouteMatch(createTask, Map.of()), "/tasks", response));

        CsrfFilter csrf = new CsrfFilter(new HttpSessionCsrfTokenRepository());
        csrf.setAccessDeniedHandler(new SecurityRefusals(boundary));
        AtomicBoolean handled = new AtomicBoolean();
        FilterChain handler = (passed, answered) -> handled.set(true);
        csrf.doFilter(request, response, handler);

        assertFalse(handled.get(), "a POST without a CSRF token never reaches the handler");
        assertEquals(403, response.heldStatus());
        assertEquals(MAPPER.readTree("{\"code\": \"api.csrf_invalid\"}"),
                MAPPER.readTree(new String(response.heldBody(), StandardCharsets.UTF_8)));
    }
}
