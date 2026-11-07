package io.github.jubasse.seampact.springboot.runtime;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;

/**
 * A hand-written `tasks` contract table of notes: a deprecated read with its successor, cached by ETag, and a write
 * versioned by `If-Match` (grammar section 6), with the response headers the generator lists in the settings.
 */
final class NotesTestContract {
    static final String DEPRECATION_DATE = "@1798675200";
    static final String SUNSET_DATE = "Wed, 30 Jun 2027 00:00:00 GMT";

    static final String TABLE = """
            {"api": {"id": "tasks", "surfaces": {"app": {"prefix": "/v1"}}},
             "errors": {
               "api.schema_invalid": {"code": "api.schema_invalid", "family": "api", "nature": "refused",
                 "http": {"status": 400}, "default": "schemaInvalid"},
               "api.precondition_required": {"code": "api.precondition_required", "family": "api", "nature": "refused",
                 "http": {"status": 428}, "default": "preconditionRequired"},
               "api.precondition_failed": {"code": "api.precondition_failed", "family": "api", "nature": "refused",
                 "http": {"status": 412}, "default": "preconditionFailed"}},
             "formats": {"bare": {
               "success": {"item": {"body": {"kind": "slot", "slot": "payload", "path": []}}},
               "error": {"media": "application/json", "headers": [], "body": {"kind": "object",
                 "members": [{"name": {"kind": "text", "text": "code"}, "value": {"kind": "slot", "slot": "code", "path": []}}]}}}},
             "operations": [
               {"id": "getLegacyNote", "method": "get", "path": "/v1/notes/{noteId}/legacy", "surface": "app", "safe": true, "format": "bare",
                "params": {"path": [{"name": "noteId", "required": true, "type": {"kind": "scalar", "refinements": {}, "type": "string"}}],
                  "query": [], "header": []},
                "cache": {"etag": true},
                "responses": [{"status": 200, "shape": "item", "media": "application/json", "headers": []}],
                "errors": []},
               {"id": "updateNote", "method": "patch", "path": "/v1/notes/{noteId}", "surface": "app", "safe": false, "format": "bare",
                "params": {"path": [{"name": "noteId", "required": true, "type": {"kind": "scalar", "refinements": {}, "type": "string"}}],
                  "query": [],
                  "header": [{"name": "If-Match", "required": true, "type": {"kind": "scalar", "refinements": {}, "type": "string"}}]},
                "concurrency": {"version": {"in": "header", "name": "If-Match"}, "field": "revision"},
                "responses": [{"status": 200, "shape": "item", "media": "application/json", "headers": []}],
                "errors": [{"code": "api.schema_invalid"}, {"code": "api.precondition_required"}, {"code": "api.precondition_failed"}]}],
             "settings": {"responseHeaders": {
               "getLegacyNote": {"200": [
                 {"kind": "text", "name": "Deprecation", "value": "@1798675200"},
                 {"kind": "text", "name": "Sunset", "value": "Wed, 30 Jun 2027 00:00:00 GMT"},
                 {"kind": "successorLink", "name": "Link", "path": "/v1/notes/{noteId}", "rel": "successor-version"},
                 {"kind": "entityTag", "name": "ETag", "field": "revision"}]},
               "updateNote": {"200": [{"kind": "entityTag", "name": "ETag", "field": "revision"}]}}}}
            """;

    /** The result arm of both operations' 200: the note as the handler returns it. */
    record NoteOk(Object body) {}

    record UpdateNoteHeaders(@JsonProperty("If-Match") String ifMatch) {}

    record UpdateNoteInput(UpdateNoteHeaders headers) {}

    private NotesTestContract() {}

    static SeampactBoundary boundary() {
        return boundary(TABLE, failure -> { });
    }

    static SeampactBoundary boundary(String table, UnexpectedErrorListener unexpectedFailures) {
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        beans.addBean("unexpectedFailures", unexpectedFailures);

        return new SeampactBoundary(table, new TasksTestBinding(Map.of(), Map.of("updateNote", UpdateNoteInput.class), Map.of(NoteOk.class, 200)),
                beans, new StandardEnvironment());
    }

    static ContractRoute route(SeampactBoundary boundary, String operationId) {
        return boundary.table().routes().stream().filter(route -> route.id().equals(operationId)).findFirst().orElseThrow();
    }
}
