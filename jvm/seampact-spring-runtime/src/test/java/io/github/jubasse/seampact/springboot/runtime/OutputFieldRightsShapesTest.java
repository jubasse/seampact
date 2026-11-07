package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.github.jubasse.seampact.hooks.Decision;
import io.github.jubasse.seampact.hooks.RequestView;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Restricted output members in every reply shape: an item, a list, a table, a page and an array nested below the member. */
class OutputFieldRightsShapesTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private static final String TABLE = """
            {"api": {"id": "tasks"},
             "rights": {"seeEffort": {"errors": ["api.forbidden"]}},
             "operations": [{"id": "readTasks", "method": "get", "path": "/tasks", "fieldRights": [
               {"direction": "output", "schema": "Task", "pointer": "/effort", "right": "seeEffort"},
               {"direction": "output", "schema": "Task", "pointer": "/subtasks/*/effort", "right": "seeEffort"},
               {"direction": "output", "schema": "Other", "pointer": "/title", "right": "seeEffort"}
             ]}]}
            """;

    private static final String TASK = "{\"id\": \"t1\", \"effort\": 3, \"title\": \"Write\", \"subtasks\": [{\"id\": \"s1\", \"effort\": 1}, {\"id\": \"s2\", \"effort\": 2}]}";
    private static final String TASK_WITHOUT_EFFORT = "{\"id\": \"t1\", \"title\": \"Write\", \"subtasks\": [{\"id\": \"s1\"}, {\"id\": \"s2\"}]}";

    @Test
    void removesADeniedMemberOfAnItemAndOfEveryItemOfANestedArray() {
        JsonNode body = MAPPER.readTree(TASK);

        apply("object", body, call -> deny());

        assertEquals(MAPPER.readTree(TASK_WITHOUT_EFFORT), body);
    }

    @Test
    void removesADeniedMemberOfEveryItemOfAList() {
        JsonNode body = MAPPER.readTree("[" + TASK + "," + TASK + "]");

        apply("list", body, call -> deny());

        assertEquals(MAPPER.readTree("[" + TASK_WITHOUT_EFFORT + "," + TASK_WITHOUT_EFFORT + "]"), body);
    }

    @Test
    void removesADeniedMemberOfEveryItemOfAPage() {
        JsonNode items = MAPPER.readTree("[" + TASK + "]");

        apply("page", items, call -> deny());

        assertEquals(MAPPER.readTree("[" + TASK_WITHOUT_EFFORT + "]"), items);
    }

    @Test
    void removesADeniedMemberOfEveryValueOfATable() {
        JsonNode body = MAPPER.readTree("{\"a\": " + TASK + ", \"b\": " + TASK + "}");

        apply("table", body, call -> deny());

        assertEquals(MAPPER.readTree("{\"a\": " + TASK_WITHOUT_EFFORT + ", \"b\": " + TASK_WITHOUT_EFFORT + "}"), body);
    }

    @Test
    void keepsAnAllowedMemberAndLeavesAnotherSchemasPointerAlone() {
        JsonNode body = MAPPER.readTree(TASK);

        apply("object", body, call -> new Decision.Allowed<>());

        assertEquals(MAPPER.readTree(TASK), body);
    }

    @Test
    void skipsAnAbsentMemberAndAnArrayThatIsNotThere() {
        JsonNode body = MAPPER.readTree("{\"id\": \"t1\", \"title\": \"Write\"}");

        apply("object", body, call -> deny());

        assertEquals(MAPPER.readTree("{\"id\": \"t1\", \"title\": \"Write\"}"), body);
    }

    @Test
    void aDeciderThatThrowsStopsTheReplyInsteadOfKeepingTheMember() {
        JsonNode body = MAPPER.readTree(TASK);

        IllegalStateException failure = assertThrows(IllegalStateException.class, () -> apply("object", body, call -> {
            throw new IllegalStateException("policy store down");
        }));

        assertEquals("policy store down", failure.getMessage());
    }

    private static Decision<Denial> deny() {
        return new Decision.Denied<>(Denial.of("api.forbidden"));
    }

    private static void apply(String shape, JsonNode body, Function<RequirementCall, Decision<Denial>> decide) {
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        beans.addBean("decider", new Decider() {
            @Override
            public Set<String> names() {
                return Set.of("seeEffort");
            }

            @Override
            public Decision<Denial> decide(RequirementCall call) {
                return decide.apply(call);
            }
        });
        SeampactBoundary boundary = new SeampactBoundary(TABLE, new TasksTestBinding(Map.of()), beans, new StandardEnvironment());
        ContractRoute route = boundary.table().routes().getFirst();
        BoundaryExchange exchange = new BoundaryExchange(new ContractTable.RouteMatch(route, Map.of()), "/tasks",
                new CheckingResponse(TestServletProxies.unusedResponse(), false));
        JsonNode response = MAPPER.readTree("{\"body\": {\"schema\": \"Task\"}, \"shape\": \"" + shape + "\"}");

        OutputFieldRights.apply(boundary, exchange, new RequestView("GET", "/tasks", Map.of(), Optional.empty()), response, body);
    }
}
