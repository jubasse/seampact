package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The page position checks of the boundary (ADR 0022 "Query and bounded values"). */
class PageReplyTest {
    private static final String CURSOR_IR = """
            {"api": {"id": "tasks", "surfaces": {"app": {"prefix": "/v1"}}},
             "operations": [
               {"id": "listTasks", "method": "get", "path": "/v1/tasks", "surface": "app",
                "paging": {"style": {"id": "cursor", "kind": "cursor", "position": "cursor",
                  "request": [{"role": "after", "name": "after"}, {"role": "before", "name": "before"}]}}}]}
            """;

    private static final String PAGE_IR = """
            {"api": {"id": "tasks", "surfaces": {"app": {"prefix": "/v1"}}},
             "operations": [
               {"id": "listTasks", "method": "get", "path": "/v1/tasks", "surface": "app",
                "paging": {"style": {"id": "springPage", "kind": "offset", "position": "page",
                  "request": [{"role": "page", "name": "page", "base": 0}, {"role": "limit", "name": "size"}]}}}]}
            """;

    private final ContractTable table = new ContractTable(BoundaryMapper.create().readTree(CURSOR_IR));
    private final ContractTable pageTable = new ContractTable(BoundaryMapper.create().readTree(PAGE_IR));

    private List<InputIssue> issuesOf(String query) {
        ContractRoute route = table.match("GET", "/v1/tasks").orElseThrow().route();
        List<InputIssue> issues = new ArrayList<>();
        PageReply.checkOnePosition(table, route, BoundaryMapper.create().readTree(query), issues);

        return issues;
    }

    @Test
    void afterAndBeforeBothSentIsOneExclusiveCursorsIssueAtBefore() {
        assertEquals(List.of(new InputIssue("query", "/before", "exclusiveCursors")), issuesOf("{\"after\": \"a\", \"before\": \"b\"}"));
    }

    @Test
    void oneOfAfterOrBeforeIsAccepted() {
        assertEquals(List.of(), issuesOf("{\"after\": \"a\"}"));
        assertEquals(List.of(), issuesOf("{\"before\": \"b\"}"));
    }

    private List<InputIssue> pageableIssuesOf(String query) {
        ContractRoute route = pageTable.match("GET", "/v1/tasks").orElseThrow().route();
        List<InputIssue> issues = new ArrayList<>();
        PageReply.checkPageableRange(pageTable, route, BoundaryMapper.create().readTree(query), issues);

        return issues;
    }

    @Test
    void aPageNumberPastSpringDataRangeIsOneMaximumIssueAtThePage() {
        assertEquals(List.of(new InputIssue("query", "/page", "maximum")), pageableIssuesOf("{\"page\": 2147483648, \"size\": 20}"));
    }

    @Test
    void theLastPageNumberSpringDataTakesIsAccepted() {
        assertEquals(List.of(), pageableIssuesOf("{\"page\": 2147483647, \"size\": 20}"));
        assertEquals(List.of(), pageableIssuesOf("{\"size\": 20}"));
    }
}
