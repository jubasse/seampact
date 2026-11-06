package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * The headers a success derives (ADR 0004 section 7): a deprecated read's Deprecation, Sunset and successor Link, and
 * the ETag of an item versioned by `If-Match`, which `cache.etag` uses too.
 */
class DerivedResponseHeadersTest {
    private static final int OK = 200;
    private static final int NOT_MODIFIED = 304;
    private static final int INTERNAL_ERROR = 500;

    private static MockHttpServletResponse answer(MockHttpServletRequest request, Object result) throws Exception {
        return answer(NotesTestContract.boundary(), request, result);
    }

    private static MockHttpServletResponse answer(SeampactBoundary boundary, MockHttpServletRequest request, Object result) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        new BoundaryFilter(boundary).doFilter(request, response, (passed, reply) ->
                new ContractReplyHandler(boundary).handleReturnValue(result, null, new ModelAndViewContainer(),
                        new ServletWebRequest((HttpServletRequest) passed, (HttpServletResponse) reply)));

        return response;
    }

    private static MockHttpServletResponse legacyRead(String noteId, Object revision) throws Exception {
        return answer(new MockHttpServletRequest("GET", "/v1/notes/" + noteId + "/legacy"), new NotesTestContract.NoteOk(Map.of("revision", revision)));
    }

    @Test
    void aDeprecatedReadWritesItsDatesAndItsSuccessorWithTheRequestsParams() throws Exception {
        MockHttpServletResponse response = legacyRead("n%20%2F1", 1);

        assertEquals(OK, response.getStatus());
        assertEquals(NotesTestContract.DEPRECATION_DATE, response.getHeader("Deprecation"));
        assertEquals(NotesTestContract.SUNSET_DATE, response.getHeader("Sunset"));
        assertEquals(List.of("</v1/notes/n%20%2F1>; rel=\"successor-version\""), response.getHeaders("Link"));
    }

    @Test
    void anItemVersionedByIfMatchCarriesItsVersionAsAStrongTag() throws Exception {
        assertEquals("\"1\"", legacyRead("n1", 1).getHeader("ETag"));
        assertEquals("\"r-7\"", legacyRead("n1", "r-7").getHeader("ETag"));
    }

    @Test
    void cacheEtagUsesTheVersionTagAndItsNotModifiedCarriesNoDeprecationHeader() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/v1/notes/n1/legacy");
        request.addHeader("If-None-Match", "W/\"1\"");

        MockHttpServletResponse response = answer(request, new NotesTestContract.NoteOk(Map.of("revision", 1)));

        assertEquals(NOT_MODIFIED, response.getStatus());
        assertEquals(List.of("\"1\""), response.getHeaders("ETag"));
        assertNull(response.getHeader("Deprecation"));
    }

    @Test
    void aHeaderKindTheRuntimeDoesNotWriteIsTheHandlersFailureNamingTheFix() throws Exception {
        String staleTable = NotesTestContract.TABLE.replace("{\"kind\": \"text\", \"name\": \"Deprecation\"", "{\"kind\": \"date\", \"name\": \"Deprecation\"");
        List<UnexpectedErrorListener.UnexpectedFailure> failures = new ArrayList<>();
        SeampactBoundary boundary = NotesTestContract.boundary(staleTable, failures::add);

        MockHttpServletResponse response = answer(boundary, new MockHttpServletRequest("GET", "/v1/notes/n1/legacy"),
                new NotesTestContract.NoteOk(Map.of("revision", 1)));

        assertEquals(INTERNAL_ERROR, response.getStatus());
        assertEquals(1, failures.size());
        assertTrue(failures.getFirst().reason().contains("the kind 'date'"), failures.getFirst().reason());
        assertTrue(failures.getFirst().cause().isEmpty());
    }

    @Test
    void aVersionNoTagCanCarryIsTheHandlersFailure() throws Exception {
        assertEquals(INTERNAL_ERROR, legacyRead("n1", "a\"b").getStatus());
        assertEquals(INTERNAL_ERROR, legacyRead("n1", 1.5).getStatus());
    }
}
