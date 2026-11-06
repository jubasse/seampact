package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * The `If-Match` version of a write (grammar section 6): a missing, empty or `*` header answers 428, a list or a value
 * that is no tag 412, and a strong or weak tag reaches the handler unquoted.
 */
class VersionHeaderTest {
    private static final String NOTE_PATH = "/v1/notes/n1";
    private static final String IF_MATCH = "If-Match";

    private static NotesTestContract.UpdateNoteInput admitted(String... ifMatch) {
        SeampactBoundary boundary = NotesTestContract.boundary();
        MockHttpServletRequest request = new MockHttpServletRequest("PATCH", NOTE_PATH);
        for (String value : ifMatch) request.addHeader(IF_MATCH, value);
        CheckingResponse response = new CheckingResponse(new MockHttpServletResponse(), false);
        ContractTable.RouteMatch match = new ContractTable.RouteMatch(NotesTestContract.route(boundary, "updateNote"), Map.of("noteId", "n1"));
        BoundaryExchange exchange = new BoundaryExchange(match, NOTE_PATH, response);

        InputStep.run(boundary, exchange, request);

        return (NotesTestContract.UpdateNoteInput) exchange.input;
    }

    private static String refusedCode(String... ifMatch) {
        return assertThrows(ContractRefusal.class, () -> admitted(ifMatch)).code();
    }

    @Test
    void aMissingOrEmptyIfMatchAnswersPreconditionRequired() {
        assertEquals("api.precondition_required", refusedCode());
        assertEquals("api.precondition_required", refusedCode(""));
        assertEquals("api.precondition_required", refusedCode("*"));
    }

    @Test
    void aStrongOrWeakTagReachesTheHandlerUnquoted() {
        assertEquals("7", admitted("\"7\"").headers().ifMatch());
        assertEquals("7", admitted("W/\"7\"").headers().ifMatch());
    }

    @Test
    void aListOrAValueThatIsNoTagAnswersPreconditionFailed() {
        assertEquals("api.precondition_failed", refusedCode("\"1\", \"2\""));
        assertEquals("api.precondition_failed", refusedCode("\"1\"", "\"2\""));
        assertEquals("api.precondition_failed", refusedCode("7"));
    }
}
