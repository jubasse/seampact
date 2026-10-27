package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** The raw-path match of the contract table (ADR 0022 "Routes"). */
class ContractTableTest {
    // getTask comes first in the IR, which orders operations by id.
    private static final String TASKS_IR = """
            {"api": {"id": "tasks", "surfaces": {"app": {"prefix": "/v1"}}},
             "operations": [
               {"id": "getTask", "method": "get", "path": "/v1/tasks/{taskId}", "surface": "app"},
               {"id": "taskStats", "method": "get", "path": "/v1/tasks/stats", "surface": "app"}]}
            """;

    private final ContractTable table = new ContractTable(BoundaryMapper.create().readTree(TASKS_IR));

    private String operationOf(String path) {
        return table.match("GET", path).orElseThrow().route().id();
    }

    @Test
    void literalSegmentBeatsAPlaceholderWhateverTheIrOrder() {
        assertEquals("taskStats", operationOf("/v1/tasks/stats"));
        assertEquals("getTask", operationOf("/v1/tasks/7"));
    }

    @Test
    void aMountedTableServesEachRouteUnderTheMountAlone() {
        String mountedIr = TASKS_IR.replace("{\"api\":", "{\"settings\": {\"mount\": \"/api\"}, \"api\":");
        ContractTable mounted = new ContractTable(BoundaryMapper.create().readTree(mountedIr));

        assertEquals("getTask", mounted.match("GET", "/api/v1/tasks/7").orElseThrow().route().id());
        assertTrue(mounted.match("GET", "/v1/tasks/7").isEmpty());
        assertTrue(mounted.isUnderBasePath("/api/v1/unknown"));
        assertFalse(mounted.isUnderBasePath("/v1/unknown"));
    }
}
