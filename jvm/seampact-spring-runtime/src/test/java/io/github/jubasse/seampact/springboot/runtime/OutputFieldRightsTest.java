package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.hooks.Purpose;
import io.github.jubasse.seampact.hooks.RequestView;
import jakarta.servlet.http.HttpServletResponse;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Restricted output members: each use site of a right is decided with its own params and pointer. */
class OutputFieldRightsTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    // `getTask` restricts `/effort` to owners and `/title` to owners and editors, both through the right `roles`;
    // `listTasks` restricts both to owners.
    private static final String TABLE = """
            {"api": {"id": "tasks"},
             "rights": {"roles": {"params": "RolesParams", "errors": ["api.forbidden"]}},
             "operations": [{"id": "getTask", "method": "get", "path": "/tasks/{taskId}", "fieldRights": [
               {"direction": "output", "schema": "Task", "pointer": "/effort", "right": "roles", "params": {"allowed": ["owner"]}},
               {"direction": "output", "schema": "Task", "pointer": "/title", "right": "roles", "params": {"allowed": ["owner", "editor"]}}
             ]},
             {"id": "listTasks", "method": "get", "path": "/tasks", "fieldRights": [
               {"direction": "output", "schema": "Task", "pointer": "/effort", "right": "roles", "params": {"allowed": ["owner"]}},
               {"direction": "output", "schema": "Task", "pointer": "/title", "right": "roles", "params": {"allowed": ["owner"]}}
             ]}]}
            """;

    record RolesParams(List<String> allowed) {}

    @Test
    void decidesTwoMembersOfOneRightWithOtherParamsApart() {
        assertEquals(MAPPER.readTree("{\"taskId\": \"t1\", \"title\": \"Write\"}"), visibleTask("getTask", new EditorDecider()));
    }

    @Test
    void decidesTwoMembersOfOneRightWithEqualParamsByPointer() {
        assertEquals(MAPPER.readTree("{\"taskId\": \"t1\", \"title\": \"Write\"}"), visibleTask("listTasks", new TitleDecider()));
    }

    private static JsonNode visibleTask(String operationId, Decider decider) {
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        beans.addBean("decider", decider);
        SeampactBoundary boundary = new SeampactBoundary(TABLE, new TasksTestBinding(Map.of("roles", RolesParams.class)), beans, new StandardEnvironment());
        ContractRoute route = boundary.table().routes().stream().filter(candidate -> candidate.id().equals(operationId)).findFirst().orElseThrow();
        BoundaryExchange exchange = new BoundaryExchange(new ContractTable.RouteMatch(route, Map.of()), "/tasks",
                new CheckingResponse(unusedResponse(), false));
        JsonNode task = MAPPER.readTree("{\"taskId\": \"t1\", \"effort\": 3, \"title\": \"Write\"}");

        OutputFieldRights.apply(boundary, exchange, new RequestView("GET", "/tasks", Map.of(), Optional.empty()),
                MAPPER.readTree("{\"body\": {\"schema\": \"Task\"}, \"shape\": \"object\"}"), task);

        return task;
    }

    // The exchange's response wrapper needs a response; the output step never writes to it.
    private static HttpServletResponse unusedResponse() {
        return HttpServletResponse.class.cast(Proxy.newProxyInstance(OutputFieldRightsTest.class.getClassLoader(),
                new Class<?>[] {HttpServletResponse.class}, (proxy, method, arguments) -> {
                    throw new UnsupportedOperationException("the output field step writes no response: " + method.getName());
                }));
    }

    /** Allows `roles` when its params let an editor in. */
    private static final class EditorDecider implements Decider {
        @Override
        public Set<String> names() {
            return Set.of("roles");
        }

        @Override
        public Decision<Denial> decide(RequirementCall call) {
            boolean editorAllowed = call.params().filter(RolesParams.class::isInstance).map(RolesParams.class::cast)
                    .map(params -> params.allowed().contains("editor")).orElse(false);

            return editorAllowed ? new Decision.Allowed<>() : new Decision.Denied<>(Denial.of("api.forbidden"));
        }
    }

    /** Allows `roles` for the field `/title` only, whatever the params. */
    private static final class TitleDecider implements Decider {
        @Override
        public Set<String> names() {
            return Set.of("roles");
        }

        @Override
        public Decision<Denial> decide(RequirementCall call) {
            boolean titleField = call.purpose() instanceof Purpose.Field field && field.pointer().equals("/title");

            return titleField ? new Decision.Allowed<>() : new Decision.Denied<>(Denial.of("api.forbidden"));
        }
    }
}
