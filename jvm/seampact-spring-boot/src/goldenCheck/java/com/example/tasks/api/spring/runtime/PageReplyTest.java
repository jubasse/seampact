package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The page position check of the boundary (ADR 0022 "Query and bounded values"). */
class PageReplyTest {
    private static final String CURSOR_IR = """
            {"api": {"id": "tasks", "surfaces": {"app": {"prefix": "/v1"}}},
             "operations": [
               {"id": "listTasks", "method": "get", "path": "/v1/tasks", "surface": "app",
                "paging": {"style": {"id": "cursor", "kind": "cursor", "position": "cursor",
                  "request": [{"role": "after", "name": "after"}, {"role": "before", "name": "before"}]}}}]}
            """;

    private final ContractTable table = new ContractTable(BoundaryMapper.create().readTree(CURSOR_IR));

    private List<InputIssue> issuesOf(String query) {
        ContractRoute route = table.match("GET", "/v1/tasks").orElseThrow().route();
        List<InputIssue> issues = new ArrayList<>();
        PageReply.checkOnePosition(table, route, BoundaryMapper.create().readTree(query), issues);

        return issues;
    }

    @Test
    void afterAndBeforeBothSentIsOneNotIssueAtBefore() {
        assertEquals(List.of(new InputIssue("query", "/before", "not")), issuesOf("{\"after\": \"a\", \"before\": \"b\"}"));
    }

    @Test
    void oneOfAfterOrBeforeIsAccepted() {
        assertEquals(List.of(), issuesOf("{\"after\": \"a\"}"));
        assertEquals(List.of(), issuesOf("{\"before\": \"b\"}"));
    }
}
