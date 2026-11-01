package com.example.consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.tasks.api.spring.TasksContractTable;
import com.example.tasks.api.spring.TasksSeampactBinding;
import io.github.jubasse.seampact.springboot.runtime.BootCheck;
import io.github.jubasse.seampact.springboot.runtime.BoundaryFilter;
import io.github.jubasse.seampact.springboot.runtime.SeampactBoundary;
import jakarta.servlet.FilterChain;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Under `seampact.tasks.unbound-operations=warn`, a route of an operation without a handler never reaches the app,
 * whatever the table's boot check switches say and whether the api declares a `notFound` reply.
 */
class UnboundOperationsTableTest {
    private static final String HEALTH_PATH = "/v1/health";
    private static final int NOT_FOUND = 404;
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    @Test
    void withTheBootCheckOffAnUnboundRouteAnswersTheApisNotFound() throws Exception {
        ObjectNode table = (ObjectNode) MAPPER.readTree(TasksContractTable.json());
        switchTheBootCheckOff(table);

        MockHttpServletResponse response = serveHealthAfterTheBootCheck(table);

        assertEquals(NOT_FOUND, response.getStatus());
        assertTrue(response.getContentAsString().contains("api.not_found"), response.getContentAsString());
    }

    @Test
    void withNoNotFoundReplyAnUnboundRouteAnswersABareNotFound() throws Exception {
        ObjectNode table = (ObjectNode) MAPPER.readTree(TasksContractTable.json());
        switchTheBootCheckOff(table);
        removeTheNotFoundRole(table);

        MockHttpServletResponse response = serveHealthAfterTheBootCheck(table);

        assertEquals(NOT_FOUND, response.getStatus());
        assertEquals("", response.getContentAsString());
    }

    // What `artefacts.bootCheck: false` writes into the table; the hook doubles are then not needed.
    private static void switchTheBootCheckOff(ObjectNode table) {
        ObjectNode bootCheck = (ObjectNode) table.path("settings").path("bootCheck");
        bootCheck.put("hooks", false);
        bootCheck.put("handlers", false);
        bootCheck.put("frameworkRoutes", false);
    }

    private static void removeTheNotFoundRole(ObjectNode table) {
        for (JsonNode operation : table.path("operations")) {
            for (JsonNode error : operation.path("errors")) {
                if (error instanceof ObjectNode listed) listed.remove("roles");
            }
        }
        for (JsonNode error : table.path("errors")) {
            if (error instanceof ObjectNode catalogued) catalogued.remove("default");
        }
    }

    // The boot check runs on an app with Spring MVC and no controller, so every operation is unbound.
    private static MockHttpServletResponse serveHealthAfterTheBootCheck(ObjectNode table) throws Exception {
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        beans.addBean("requestMappingHandlerMapping", new RequestMappingHandlerMapping());
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource("slice", Map.of("seampact.tasks.unbound-operations", "warn")));

        SeampactBoundary boundary = new SeampactBoundary(MAPPER.writeValueAsString(table), new TasksSeampactBinding(), beans, environment);
        new BootCheck(boundary).afterSingletonsInstantiated();

        AtomicBoolean reachedTheApp = new AtomicBoolean();
        FilterChain app = (request, response) -> reachedTheApp.set(true);
        MockHttpServletResponse response = new MockHttpServletResponse();
        new BoundaryFilter(boundary).doFilter(new MockHttpServletRequest("GET", HEALTH_PATH), response, app);

        assertEquals(false, reachedTheApp.get(), "the request reached the app");
        return response;
    }
}
