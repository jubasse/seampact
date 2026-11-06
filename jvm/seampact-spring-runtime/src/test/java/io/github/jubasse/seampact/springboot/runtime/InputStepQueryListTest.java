package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Query lists reach the validator one item per value, as their wire form writes them. */
class InputStepQueryListTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    // `sort` is written comma-separated (`explode: false`), `tag` repeated (the default form).
    private static final String TABLE = """
            {"api": {"id": "tasks"},
             "operations": [{"id": "listTasks", "method": "get", "path": "/tasks", "fieldRights": [],
               "params": {"path": [], "header": [], "query": [
                 {"name": "sort", "required": false, "type": {"kind": "array", "items": {"kind": "scalar", "type": "string"}},
                  "wire": {"kind": "list", "style": "form", "explode": false, "brackets": false}},
                 {"name": "tag", "required": false, "type": {"kind": "array", "items": {"kind": "scalar", "type": "string"}},
                  "wire": {"kind": "list", "style": "form", "explode": true, "brackets": false}}]}}]}
            """;

    record ListTasksInput(JsonNode query) {}

    @Test
    void splitsAnUnexplodedListOnItsCommas() {
        assertEquals(MAPPER.readTree("{\"sort\": [\"title\", \"-createdAt\"]}"), decodedQuery("sort=title,-createdAt"));
    }

    @Test
    void keepsAnEncodedCommaInsideOneItem() {
        assertEquals(MAPPER.readTree("{\"sort\": [\"a,b\", \"c\"]}"), decodedQuery("sort=a%2Cb,c"));
    }

    @Test
    void takesEachValueOfARepeatedListAsOneItem() {
        assertEquals(MAPPER.readTree("{\"tag\": [\"a,b\", \"c\"]}"), decodedQuery("tag=a,b&tag=c"));
    }

    private static JsonNode decodedQuery(String rawQuery) {
        SeampactBoundary boundary = new SeampactBoundary(TABLE, new TasksTestBinding(Map.of(), Map.of("listTasks", ListTasksInput.class), Map.of()),
                new StaticListableBeanFactory(), new StandardEnvironment());
        ContractRoute route = boundary.table().routes().get(0);
        BoundaryExchange exchange = new BoundaryExchange(new ContractTable.RouteMatch(route, Map.of()), "/tasks",
                new CheckingResponse(TestServletProxies.unusedResponse(), false));

        InputStep.run(boundary, exchange, TestServletProxies.getRequest(rawQuery));

        return exchange.query;
    }
}
