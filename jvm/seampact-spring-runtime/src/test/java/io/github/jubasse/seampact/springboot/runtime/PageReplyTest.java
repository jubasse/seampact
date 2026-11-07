package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** The paged list's limit, its cursor and page-number rules, and the body, headers and links its style writes. */
class PageReplyTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private static final String TABLE = """
            {"api": {"id": "tasks"},
             "pagings": {
               "numbered": {"id": "numbered", "position": "offset", "handlerResult": ["total"],
                 "request": [{"role": "limit", "name": "limit"}, {"role": "offset", "name": "offset"}],
                 "response": {
                   "body": {"kind": "object", "members": [
                     {"name": {"kind": "text", "text": "items"}, "value": {"kind": "slot", "slot": "items", "path": []}},
                     {"name": {"kind": "text", "text": "total"}, "value": {"kind": "slot", "slot": "total", "path": []}}]},
                   "headers": [{"name": "X-Total-Count", "value": {"kind": "slot", "slot": "total", "path": []}}],
                   "links": [{"role": "next", "rel": "next"}, {"role": "previous", "rel": "prev"}, {"role": "last", "rel": "last"}]}},
               "pages": {"id": "pages", "position": "page", "handlerResult": ["more"],
                 "request": [{"role": "limit", "name": "size"}, {"role": "page", "name": "page", "base": 1}],
                 "response": {"body": {"kind": "object", "members": [
                   {"name": {"kind": "text", "text": "items"}, "value": {"kind": "slot", "slot": "items", "path": []}}]}}},
               "tokens": {"id": "tokens", "position": "cursor", "handlerResult": ["nextCursor", "previousCursor"],
                 "request": [{"role": "limit", "name": "limit"}, {"role": "after", "name": "after"}, {"role": "before", "name": "before"}],
                 "response": {"body": {"kind": "object", "members": [
                   {"name": {"kind": "text", "text": "items"}, "value": {"kind": "slot", "slot": "items", "path": []}}]},
                   "links": [{"role": "next", "rel": "next"}, {"role": "previous", "rel": "prev"}]}}},
             "operations": [
               {"id": "listNumbered", "method": "get", "path": "/numbered", "paging": {"style": "numbered", "defaultLimit": 2, "maxLimit": 5, "overLimit": "clamp"}},
               {"id": "listPages", "method": "get", "path": "/pages", "paging": {"style": "pages", "defaultLimit": 2}},
               {"id": "listTokens", "method": "get", "path": "/tokens", "paging": {"style": "tokens", "defaultLimit": 3}},
               {"id": "listPlain", "method": "get", "path": "/plain"}]}
            """;

    private final ContractTable table = new ContractTable(MAPPER.readTree(TABLE));

    private ContractRoute route(String operationId) {
        return table.routes().stream().filter(candidate -> candidate.id().equals(operationId)).findFirst().orElseThrow();
    }

    private static ObjectNode query(String json) {
        return (ObjectNode) MAPPER.readTree(json);
    }

    private PageReply.RenderedPage render(String operationId, String sentQuery, String rawQuery, String handlerFacts, int itemCount, Optional<String> origin) {
        BoundaryExchange exchange = new BoundaryExchange(new ContractTable.RouteMatch(route(operationId), Map.of()), "/p",
                new CheckingResponse(TestServletProxies.unusedResponse(), false));
        exchange.query = query(sentQuery);
        List<JsonNode> items = new ArrayList<>();
        for (int index = 0; index < itemCount; index++) items.add(MAPPER.readTree("{\"n\": " + index + "}"));

        return PageReply.render(table, exchange, rawQuery, "/numbered", origin, MAPPER.readTree(handlerFacts), MAPPER.createArrayNode().addAll(items), 200);
    }

    @Test
    void fillsTheDefaultLimitWhenTheClientSentNone() {
        ObjectNode sent = query("{}");

        PageReply.fillLimit(table, route("listNumbered"), sent);

        assertEquals(2, sent.path("limit").asLong());
    }

    @Test
    void clampsALimitAboveTheMaximumAndKeepsOneBelowIt() {
        ObjectNode above = query("{\"limit\": 50}");
        ObjectNode below = query("{\"limit\": 4}");

        PageReply.fillLimit(table, route("listNumbered"), above);
        PageReply.fillLimit(table, route("listNumbered"), below);

        assertEquals(5, above.path("limit").asLong());
        assertEquals(4, below.path("limit").asLong());
    }

    @Test
    void leavesAnUnpagedRouteAndAStyleWithoutALimitRoleAlone() {
        ObjectNode sent = query("{\"limit\": 50}");

        PageReply.fillLimit(table, route("listPlain"), sent);

        assertEquals(50, sent.path("limit").asLong());
    }

    @Test
    void refusesAfterAndBeforeSentTogetherAtTheBeforeParameter() {
        List<InputIssue> issues = new ArrayList<>();

        PageReply.checkOnePosition(table, route("listTokens"), query("{\"after\": \"a\", \"before\": \"b\"}"), issues);
        PageReply.checkOnePosition(table, route("listTokens"), query("{\"after\": \"a\"}"), issues);
        PageReply.checkOnePosition(table, route("listNumbered"), query("{\"after\": \"a\", \"before\": \"b\"}"), issues);

        assertEquals(List.of(new InputIssue("query", "/before", "exclusiveCursors")), issues);
    }

    @Test
    void refusesAPageNumberPastWhatAPageableHolds() {
        List<InputIssue> issues = new ArrayList<>();
        long lastPage = Integer.MAX_VALUE + 1L;

        PageReply.checkPageableRange(table, route("listPages"), query("{\"page\": " + lastPage + "}"), issues);
        PageReply.checkPageableRange(table, route("listPages"), query("{\"page\": " + (lastPage + 1) + "}"), issues);
        PageReply.checkPageableRange(table, route("listNumbered"), query("{\"offset\": 99999999999}"), issues);

        assertEquals(List.of(new InputIssue("query", "/page", "maximum")), issues);
    }

    @Test
    void rendersAnOffsetPageWithItsBodyHeaderAndNavigationLinks() {
        PageReply.RenderedPage page = render("listNumbered", "{\"limit\": 2, \"offset\": 2}", "limit=2&offset=2", "{\"total\": 7}", 2, Optional.empty());

        assertEquals(MAPPER.readTree("{\"items\": [{\"n\": 0}, {\"n\": 1}], \"total\": 7}"), page.body());
        assertEquals(Map.entry("X-Total-Count", "7"), page.headers().getFirst());
        assertEquals("<?limit=2&offset=4>; rel=\"next\", <?limit=2&offset=0>; rel=\"prev\", <?limit=2&offset=6>; rel=\"last\"",
                page.headers().get(1).getValue());
    }

    @Test
    void writesAbsoluteLinksFromThePublicOriginAndNeverFromTheRequest() {
        PageReply.RenderedPage page = render("listNumbered", "{\"limit\": 2}", "limit=2", "{\"total\": 7}", 2, Optional.of("https://api.example.com"));

        assertEquals("<https://api.example.com/numbered?limit=2&offset=2>; rel=\"next\", <https://api.example.com/numbered?limit=2&offset=6>; rel=\"last\"",
                page.headers().get(1).getValue());
    }

    @Test
    void writesNoNextLinkOnTheLastPageAndNoPreviousOnTheFirst() {
        PageReply.RenderedPage last = render("listNumbered", "{\"limit\": 2, \"offset\": 6}", "limit=2&offset=6", "{\"total\": 7}", 1, Optional.empty());
        PageReply.RenderedPage first = render("listNumbered", "{\"limit\": 2}", "limit=2", "{\"total\": 7}", 2, Optional.empty());

        assertEquals("<?limit=2&offset=4>; rel=\"prev\", <?limit=2&offset=6>; rel=\"last\"", last.headers().get(1).getValue());
        assertEquals(false, first.headers().get(1).getValue().contains("rel=\"prev\""));
    }

    @Test
    void aListWithoutALimitCannotBeRenderedAsNumberedPages() {
        IllegalStateException failure = assertThrows(IllegalStateException.class,
                () -> render("listNumbered", "{}", "", "{\"total\": 7}", 1, Optional.empty()));

        assertEquals("seampact: the list 'listNumbered' has no limit", failure.getMessage());
    }

    @Test
    void rendersACursorPageWithTheTokensTheHandlerReturned() {
        PageReply.RenderedPage page = render("listTokens", "{\"limit\": 3}", "limit=3&after=old", "{\"nextCursor\": \"n1\", \"previousCursor\": \"p1\"}", 3, Optional.empty());

        assertEquals("<?limit=3&after=n1>; rel=\"next\", <?limit=3&before=p1>; rel=\"prev\"", page.headers().getFirst().getValue());
    }

    @Test
    void rendersAPageNumberedFromItsBaseWithoutALinkForAStyleThatWritesNone() {
        PageReply.RenderedPage page = render("listPages", "{\"size\": 2, \"page\": 3}", "size=2&page=3", "{\"more\": true}", 2, Optional.empty());

        assertEquals(MAPPER.readTree("{\"items\": [{\"n\": 0}, {\"n\": 1}]}"), page.body());
        assertEquals(List.of(), page.headers());
    }
}
