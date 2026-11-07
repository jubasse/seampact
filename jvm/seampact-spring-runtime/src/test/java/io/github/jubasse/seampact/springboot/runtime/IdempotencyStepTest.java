package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.jubasse.seampact.hooks.IdempotencyBegin;
import io.github.jubasse.seampact.hooks.IdempotencyClaim;
import io.github.jubasse.seampact.hooks.IdempotencyStore;
import io.github.jubasse.seampact.hooks.StoredResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** The idempotency claim, replay, in-progress and reuse answers, and which replies are stored or dropped. */
class IdempotencyStepTest {
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private static final String TABLE = """
            {"api": {"id": "tasks"},
             "errors": {
               "api.in_progress": {"code": "api.in_progress", "family": "api", "nature": "refused", "http": {"status": 409}, "default": "idempotencyInProgress"},
               "api.key_reused": {"code": "api.key_reused", "family": "api", "nature": "refused", "http": {"status": 422}, "default": "idempotencyKeyReused"},
               "api.secret": {"code": "api.secret", "family": "api", "nature": "refused", "http": {"status": 400}, "noStore": true},
               "api.bad": {"code": "api.bad", "family": "api", "nature": "refused", "http": {"status": 400}}},
             "identities": {"session": {"kind": "bearer"}},
             "schemes": {"token": {"kind": "bearer"}},
             "operations": [
               {"id": "createTask", "method": "post", "path": "/tasks", "safe": false,
                "access": {"kind": "required", "identity": "session", "schemes": ["token"]},
                "idempotency": {"kind": "derived", "enforce": "boundary", "header": "Idempotency-Key", "lifetimeMs": 60000, "replayHeader": "Idempotent-Replayed"},
                "responses": [{"status": 201, "headers": [{"name": "Location"}]}],
                "errors": [{"code": "api.in_progress"}, {"code": "api.key_reused"}, {"code": "api.secret"}, {"code": "api.bad"}]},
               {"id": "listTasks", "method": "get", "path": "/tasks", "safe": true, "errors": []},
               {"id": "noFingerprint", "method": "post", "path": "/untracked", "safe": false,
                "idempotency": {"kind": "derived", "enforce": "boundary", "header": "Idempotency-Key", "lifetimeMs": 1, "replayHeader": "Idempotent-Replayed"},
                "errors": []}],
             "settings": {"fingerprintHeaders": {"createTask": ["x-ok", "authorization"]}}}
            """;

    private static final String KEYED_INPUT = """
            {"headers": {"Idempotency-Key": "k1", "Authorization": "Bearer one", "X-Ok": "1", "X-Trace": "t1"}, "body": {"title": "Write"}}
            """;

    @Test
    void anOperationWithoutAnIdempotencyKeyClaimsNothing() throws IOException {
        Fixture fixture = new Fixture("createTask", "{\"headers\": {}, \"body\": {}}");

        assertFalse(IdempotencyStep.begin(fixture.boundary, fixture.exchange));
        assertTrue(fixture.store.claims.isEmpty());
    }

    @Test
    void anOperationThatIsNotIdempotentClaimsNothing() throws IOException {
        Fixture fixture = new Fixture("listTasks", KEYED_INPUT);

        assertFalse(IdempotencyStep.begin(fixture.boundary, fixture.exchange));
        assertTrue(fixture.store.claims.isEmpty());
    }

    @Test
    void aFirstRequestClaimsTheKeyAndRunsTheHandler() throws IOException {
        Fixture fixture = new Fixture("createTask", KEYED_INPUT);

        assertFalse(IdempotencyStep.begin(fixture.boundary, fixture.exchange));

        IdempotencyClaim claim = fixture.store.claims.getFirst();
        assertEquals(claim.key(), fixture.exchange.idempotencyKey);
        assertEquals(64, claim.key().length());
        assertEquals(60000L, claim.lifetimeMs());
        assertEquals("createTask", claim.operation().id());
    }

    @Test
    void theKeyIsPerPrincipalAndTheFingerprintIgnoresCredentialsAndUndeclaredHeaders() throws IOException {
        Fixture alice = new Fixture("createTask", KEYED_INPUT);
        alice.exchange.principal = Map.of("id", "alice");
        Fixture aliceRefreshed = new Fixture("createTask", KEYED_INPUT.replace("Bearer one", "Bearer two").replace("\"t1\"", "\"t2\""));
        aliceRefreshed.exchange.principal = Map.of("id", "alice");
        Fixture bob = new Fixture("createTask", KEYED_INPUT);
        bob.exchange.principal = Map.of("id", "bob");

        IdempotencyStep.begin(alice.boundary, alice.exchange);
        IdempotencyStep.begin(aliceRefreshed.boundary, aliceRefreshed.exchange);
        IdempotencyStep.begin(bob.boundary, bob.exchange);

        assertEquals(alice.store.claims.getFirst(), aliceRefreshed.store.claims.getFirst());
        assertNotEquals(alice.store.claims.getFirst().key(), bob.store.claims.getFirst().key());
        assertEquals(alice.store.claims.getFirst().fingerprint(), bob.store.claims.getFirst().fingerprint());
    }

    @Test
    void aDeclaredHeaderOrAnotherBodyChangesTheFingerprint() throws IOException {
        Fixture original = new Fixture("createTask", KEYED_INPUT);
        Fixture otherHeader = new Fixture("createTask", KEYED_INPUT.replace("\"X-Ok\": \"1\"", "\"X-Ok\": \"2\""));
        Fixture otherBody = new Fixture("createTask", KEYED_INPUT.replace("Write", "Read"));

        IdempotencyStep.begin(original.boundary, original.exchange);
        IdempotencyStep.begin(otherHeader.boundary, otherHeader.exchange);
        IdempotencyStep.begin(otherBody.boundary, otherBody.exchange);

        String fingerprint = original.store.claims.getFirst().fingerprint();
        assertNotEquals(fingerprint, otherHeader.store.claims.getFirst().fingerprint());
        assertNotEquals(fingerprint, otherBody.store.claims.getFirst().fingerprint());
    }

    @Test
    void aClaimStillRunningIsTheInProgressRefusal() {
        Fixture fixture = new Fixture("createTask", KEYED_INPUT);
        fixture.store.answer = new IdempotencyBegin.Running();

        ContractRefusal refusal = assertThrows(ContractRefusal.class, () -> IdempotencyStep.begin(fixture.boundary, fixture.exchange));

        assertEquals("api.in_progress", refusal.code());
        assertNull(fixture.exchange.idempotencyKey);
    }

    @Test
    void aKeyReusedWithAnotherRequestIsTheKeyReusedRefusal() {
        Fixture fixture = new Fixture("createTask", KEYED_INPUT);
        fixture.store.answer = new IdempotencyBegin.Mismatch();

        ContractRefusal refusal = assertThrows(ContractRefusal.class, () -> IdempotencyStep.begin(fixture.boundary, fixture.exchange));

        assertEquals("api.key_reused", refusal.code());
    }

    @Test
    void aStoredSuccessIsReplayedWithTheReplayHeaderAndNeverRunsTheHandler() throws IOException {
        Fixture fixture = new Fixture("createTask", KEYED_INPUT);
        fixture.store.answer = new IdempotencyBegin.Replay(new StoredResponse(201, List.of(
                new StoredResponse.Header("content-type", "application/json"),
                new StoredResponse.Header("location", "/tasks/t1"),
                new StoredResponse.Header("idempotent-replayed", "stale")), "{\"id\":\"t1\"}".getBytes(StandardCharsets.UTF_8)));

        assertTrue(IdempotencyStep.begin(fixture.boundary, fixture.exchange));

        assertEquals(201, fixture.exchange.response.heldStatus());
        assertEquals("{\"id\":\"t1\"}", new String(fixture.exchange.response.heldBody(), StandardCharsets.UTF_8));
        assertEquals("/tasks/t1", fixture.servletResponse.getHeader("location"));
        assertEquals("application/json", fixture.servletResponse.getContentType());
        assertEquals(List.of("true"), fixture.servletResponse.getHeaders("Idempotent-Replayed"));
        assertTrue(fixture.exchange.boundaryWrote);
    }

    @Test
    void aStoredErrorIsReplayedWithoutTheReplayHeader() throws IOException {
        Fixture fixture = new Fixture("createTask", KEYED_INPUT);
        fixture.store.answer = new IdempotencyBegin.Replay(new StoredResponse(400, List.of(), new byte[0]));

        assertTrue(IdempotencyStep.begin(fixture.boundary, fixture.exchange));

        assertEquals(400, fixture.exchange.response.heldStatus());
        assertNull(fixture.servletResponse.getHeader("Idempotent-Replayed"));
    }

    @Test
    void aStoreThatFailsToBeginFailsTheRequestInsteadOfRunningTheWriteUnclaimed() {
        Fixture fixture = new Fixture("createTask", KEYED_INPUT);
        fixture.store.beginFailure = new IllegalStateException("store down");

        IllegalStateException failure = assertThrows(IllegalStateException.class, () -> IdempotencyStep.begin(fixture.boundary, fixture.exchange));

        assertEquals("store down", failure.getMessage());
        assertNull(fixture.exchange.idempotencyKey);
    }

    @Test
    void aTableWithoutFingerprintHeadersForAnIdempotentOperationIsNamed() {
        Fixture fixture = new Fixture("noFingerprint", KEYED_INPUT);

        IllegalStateException failure = assertThrows(IllegalStateException.class, () -> IdempotencyStep.begin(fixture.boundary, fixture.exchange));

        assertEquals("seampact: the contract table lists no fingerprint headers for the idempotent operation 'noFingerprint'; regenerate the Spring Boot sources",
                failure.getMessage());
    }

    @Test
    void aSuccessIsCompletedWithItsContentAndDeclaredHeadersOnly() throws IOException {
        Fixture fixture = claimed();
        fixture.servletResponse.setContentType("application/json");
        fixture.exchange.response.setStatus(201);
        fixture.exchange.response.setHeader("Location", "/tasks/t1");
        fixture.exchange.response.setHeader("Content-Language", "en");
        fixture.exchange.response.setHeader("Set-Cookie", "JSESSIONID=1");
        fixture.exchange.response.setHeader("X-Frame-Options", "DENY");

        IdempotencyStep.settle(fixture.boundary, fixture.exchange, "{}".getBytes(StandardCharsets.UTF_8));

        StoredResponse stored = fixture.store.completed.getFirst();
        assertEquals(201, stored.status());
        assertEquals(List.of("content-type", "location", "content-language"), stored.headers().stream().map(StoredResponse.Header::name).toList());
        assertNull(fixture.exchange.idempotencyKey);
    }

    @Test
    void aServerErrorIsAbandonedSoARetryRunsAgain() throws IOException {
        Fixture fixture = claimed();
        fixture.exchange.response.setStatus(503);

        IdempotencyStep.settle(fixture.boundary, fixture.exchange, new byte[0]);

        assertEquals(1, fixture.store.abandoned.size());
        assertTrue(fixture.store.completed.isEmpty());
    }

    @Test
    void aNoStoreErrorIsAbandonedButANoStoreSuccessIsKept() throws IOException {
        Fixture secretError = claimed();
        secretError.exchange.response.setStatus(400);
        secretError.exchange.response.setHeader("Cache-Control", "private, No-Store");
        Fixture secretSuccess = claimed();
        secretSuccess.exchange.response.setStatus(201);
        secretSuccess.exchange.response.setHeader("Cache-Control", "no-store");

        IdempotencyStep.settle(secretError.boundary, secretError.exchange, new byte[0]);
        IdempotencyStep.settle(secretSuccess.boundary, secretSuccess.exchange, new byte[0]);

        assertEquals(1, secretError.store.abandoned.size());
        assertTrue(secretError.store.completed.isEmpty());
        assertEquals(1, secretSuccess.store.completed.size());
    }

    @Test
    void aClientErrorWithoutNoStoreIsKeptForReplay() throws IOException {
        Fixture fixture = claimed();
        fixture.exchange.response.setStatus(400);

        IdempotencyStep.settle(fixture.boundary, fixture.exchange, new byte[0]);

        assertEquals(1, fixture.store.completed.size());
    }

    @Test
    void aStoreThatFailsToCompleteIsLoggedAndTheReplyStillGoesOut() throws IOException {
        Fixture fixture = claimed();
        fixture.exchange.response.setStatus(201);
        fixture.store.completeFailure = new IllegalStateException("store down");

        IdempotencyStep.settle(fixture.boundary, fixture.exchange, new byte[0]);

        assertNull(fixture.exchange.idempotencyKey, "the claim is released from the exchange even when the store fails");
    }

    @Test
    void aStoreThatFailsToAbandonIsLoggedAndTheExchangeReleased() throws IOException {
        Fixture fixture = claimed();
        fixture.store.abandonFailure = new IllegalStateException("store down");

        IdempotencyStep.abandon(fixture.boundary, fixture.exchange);

        assertNull(fixture.exchange.idempotencyKey);
    }

    @Test
    void settlingAndAbandoningWithoutAClaimTouchTheStoreNever() {
        Fixture fixture = new Fixture("createTask", KEYED_INPUT);

        IdempotencyStep.settle(fixture.boundary, fixture.exchange, new byte[0]);
        IdempotencyStep.abandon(fixture.boundary, fixture.exchange);

        assertTrue(fixture.store.completed.isEmpty());
        assertTrue(fixture.store.abandoned.isEmpty());
    }

    private static Fixture claimed() throws IOException {
        Fixture fixture = new Fixture("createTask", KEYED_INPUT);
        IdempotencyStep.begin(fixture.boundary, fixture.exchange);

        return fixture;
    }

    /** The store the app registers, scripted. */
    private static final class ScriptedStore implements IdempotencyStore {
        final List<IdempotencyClaim> claims = new ArrayList<>();
        final List<StoredResponse> completed = new ArrayList<>();
        final List<String> abandoned = new ArrayList<>();
        IdempotencyBegin answer = new IdempotencyBegin.Started();
        RuntimeException beginFailure;
        RuntimeException completeFailure;
        RuntimeException abandonFailure;

        @Override
        public IdempotencyBegin begin(IdempotencyClaim claim) {
            if (beginFailure != null) throw beginFailure;
            claims.add(claim);

            return answer;
        }

        @Override
        public void complete(String key, StoredResponse response) {
            if (completeFailure != null) throw completeFailure;
            completed.add(response);
        }

        @Override
        public void abandon(String key) {
            if (abandonFailure != null) throw abandonFailure;
            abandoned.add(key);
        }
    }

    private static final class Fixture {
        final ScriptedStore store = new ScriptedStore();
        final MockHttpServletResponse servletResponse = new MockHttpServletResponse();
        final SeampactBoundary boundary;
        final BoundaryExchange exchange;

        Fixture(String operationId, String inputTree) {
            StaticListableBeanFactory beans = new StaticListableBeanFactory();
            beans.addBean("store", store);
            boundary = new SeampactBoundary(TABLE, new TasksTestBinding(Map.of()), beans, new StandardEnvironment());
            ContractRoute route = boundary.table().routes().stream().filter(candidate -> candidate.id().equals(operationId)).findFirst().orElseThrow();
            exchange = new BoundaryExchange(new ContractTable.RouteMatch(route, Map.of()), route.operation().path("path").asString(),
                    new CheckingResponse(servletResponse, false));
            JsonNode tree = MAPPER.readTree(inputTree);
            exchange.inputTree = tree;
        }
    }
}
