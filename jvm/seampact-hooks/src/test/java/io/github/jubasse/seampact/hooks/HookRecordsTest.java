package io.github.jubasse.seampact.hooks;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;

/** What the hook records keep of their inputs: defensive copies, value equality on arrays and refused nulls. */
class HookRecordsTest {
    private static final SignatureTemplate TEMPLATE = new SignatureTemplate("hmac-sha256", "{ts}.{body}", SignatureEncoding.HEX, Optional.of(300_000L));

    @Test
    void storedResponseCopiesItsBodyAndHeadersOnConstructionAndOnRead() {
        byte[] body = {1, 2, 3};
        List<StoredResponse.Header> headers = new ArrayList<>(List.of(new StoredResponse.Header("etag", "v1")));
        StoredResponse response = new StoredResponse(200, headers, body);

        body[0] = 9;
        headers.clear();
        response.body()[1] = 9;

        assertArrayEquals(new byte[] {1, 2, 3}, response.body());
        assertEquals(1, response.headers().size());
        assertThrows(UnsupportedOperationException.class, () -> response.headers().clear());
    }

    @Test
    void storedResponsesAreEqualByStatusHeadersAndBodyBytes() {
        StoredResponse first = new StoredResponse(200, List.of(new StoredResponse.Header("etag", "v1")), new byte[] {1, 2});
        StoredResponse same = new StoredResponse(200, List.of(new StoredResponse.Header("etag", "v1")), new byte[] {1, 2});

        assertEquals(first, same);
        assertEquals(first.hashCode(), same.hashCode());
        assertNotEquals(first, new StoredResponse(201, first.headers(), new byte[] {1, 2}));
        assertNotEquals(first, new StoredResponse(200, List.of(), new byte[] {1, 2}));
        assertNotEquals(first, new StoredResponse(200, first.headers(), new byte[] {1, 3}));
        assertNotEquals(first, "not a response");
    }

    @Test
    void storedResponseRefusesNullPartsByName() {
        assertNullRefused("headers", () -> new StoredResponse(200, null, new byte[0]));
        assertNullRefused("body", () -> new StoredResponse(200, List.of(), null));
        assertNullRefused("name", () -> new StoredResponse.Header(null, "v"));
        assertNullRefused("value", () -> new StoredResponse.Header("n", null));
    }

    @Test
    void signedTemplateRequestCopiesItsRawBodyAndSignatures() {
        byte[] body = {1, 2, 3};
        List<String> signatures = new ArrayList<>(List.of("sig-1"));
        SignedTemplateRequest request = new SignedTemplateRequest(body, Optional.of("1"), signatures, "key-1", TEMPLATE);

        body[0] = 9;
        signatures.add("forged");
        request.rawBody()[1] = 9;

        assertArrayEquals(new byte[] {1, 2, 3}, request.rawBody());
        assertEquals(List.of("sig-1"), request.candidateSignatures());
    }

    @Test
    void signedTemplateRequestsAreEqualByEveryPartIncludingBodyBytes() {
        SignedTemplateRequest first = new SignedTemplateRequest(new byte[] {1}, Optional.of("1"), List.of("a"), "k", TEMPLATE);
        SignedTemplateRequest same = new SignedTemplateRequest(new byte[] {1}, Optional.of("1"), List.of("a"), "k", TEMPLATE);

        assertEquals(first, same);
        assertEquals(first.hashCode(), same.hashCode());
        assertNotEquals(first, new SignedTemplateRequest(new byte[] {2}, Optional.of("1"), List.of("a"), "k", TEMPLATE));
        assertNotEquals(first, new SignedTemplateRequest(new byte[] {1}, Optional.empty(), List.of("a"), "k", TEMPLATE));
        assertNotEquals(first, new SignedTemplateRequest(new byte[] {1}, Optional.of("1"), List.of("b"), "k", TEMPLATE));
        assertNotEquals(first, new SignedTemplateRequest(new byte[] {1}, Optional.of("1"), List.of("a"), "other", TEMPLATE));
        assertNotEquals(first, new SignedTemplateRequest(new byte[] {1}, Optional.of("1"), List.of("a"), "k",
                new SignatureTemplate("hmac-sha512", "{ts}.{body}", SignatureEncoding.HEX, Optional.empty())));
        assertNotEquals(first, "not a request");
    }

    @Test
    void signedTemplateRequestRefusesNullPartsByName() {
        assertNullRefused("rawBody", () -> new SignedTemplateRequest(null, Optional.empty(), List.of(), "k", TEMPLATE));
        assertNullRefused("timestamp", () -> new SignedTemplateRequest(new byte[0], null, List.of(), "k", TEMPLATE));
        assertNullRefused("candidateSignatures", () -> new SignedTemplateRequest(new byte[0], Optional.empty(), null, "k", TEMPLATE));
        assertNullRefused("keyId", () -> new SignedTemplateRequest(new byte[0], Optional.empty(), List.of(), null, TEMPLATE));
        assertNullRefused("template", () -> new SignedTemplateRequest(new byte[0], Optional.empty(), List.of(), "k", null));
    }

    @Test
    void signedApplicationRequestCopiesItsRawBodyAndHeaders() {
        byte[] body = {1, 2, 3};
        Map<String, String> headers = new HashMap<>(Map.of("x-extra", "1"));
        SignedApplicationRequest request = new SignedApplicationRequest(body, "sig", headers, Optional.of("key-1"));

        body[0] = 9;
        headers.put("x-forged", "1");
        request.rawBody()[1] = 9;

        assertArrayEquals(new byte[] {1, 2, 3}, request.rawBody());
        assertEquals(Map.of("x-extra", "1"), request.headers());
        assertThrows(UnsupportedOperationException.class, () -> request.headers().clear());
    }

    @Test
    void signedApplicationRequestsAreEqualByEveryPartIncludingBodyBytes() {
        SignedApplicationRequest first = new SignedApplicationRequest(new byte[] {1}, "sig", Map.of("h", "1"), Optional.of("k"));
        SignedApplicationRequest same = new SignedApplicationRequest(new byte[] {1}, "sig", Map.of("h", "1"), Optional.of("k"));

        assertEquals(first, same);
        assertEquals(first.hashCode(), same.hashCode());
        assertNotEquals(first, new SignedApplicationRequest(new byte[] {2}, "sig", Map.of("h", "1"), Optional.of("k")));
        assertNotEquals(first, new SignedApplicationRequest(new byte[] {1}, "other", Map.of("h", "1"), Optional.of("k")));
        assertNotEquals(first, new SignedApplicationRequest(new byte[] {1}, "sig", Map.of(), Optional.of("k")));
        assertNotEquals(first, new SignedApplicationRequest(new byte[] {1}, "sig", Map.of("h", "1"), Optional.empty()));
        assertNotEquals(first, "not a request");
    }

    @Test
    void signedApplicationRequestRefusesNullPartsByName() {
        assertNullRefused("rawBody", () -> new SignedApplicationRequest(null, "sig", Map.of(), Optional.empty()));
        assertNullRefused("signatureHeader", () -> new SignedApplicationRequest(new byte[0], null, Map.of(), Optional.empty()));
        assertNullRefused("headers", () -> new SignedApplicationRequest(new byte[0], "sig", null, Optional.empty()));
        assertNullRefused("keyId", () -> new SignedApplicationRequest(new byte[0], "sig", Map.of(), null));
    }

    @Test
    void throttleBucketKeepsANullKeyValueAndCopiesItsValues() {
        List<Object> values = new ArrayList<>(Arrays.asList("p1", null));
        ThrottleBucket bucket = new ThrottleBucket("perProject", "abc", values, Optional.of(5L), Optional.empty());

        values.add("forged");

        assertEquals(Arrays.asList("p1", null), bucket.values());
        assertThrows(UnsupportedOperationException.class, () -> bucket.values().clear());
    }

    @Test
    void throttleBucketRefusesNullPartsByName() {
        assertNullRefused("id", () -> new ThrottleBucket(null, "k", List.of(), Optional.empty(), Optional.empty()));
        assertNullRefused("key", () -> new ThrottleBucket("b", null, List.of(), Optional.empty(), Optional.empty()));
        assertNullRefused("values", () -> new ThrottleBucket("b", "k", null, Optional.empty(), Optional.empty()));
        assertNullRefused("limit", () -> new ThrottleBucket("b", "k", List.of(), null, Optional.empty()));
        assertNullRefused("windowMs", () -> new ThrottleBucket("b", "k", List.of(), Optional.empty(), null));
    }

    @Test
    void requestViewCopiesItsHeadersAndRefusesNulls() {
        List<String> values = new ArrayList<>(List.of("a"));
        Map<String, List<String>> headers = new HashMap<>(Map.of("x", values));
        RequestView view = new RequestView("GET", "/p", headers, Optional.empty());

        values.add("forged");
        headers.clear();

        assertEquals(Map.of("x", List.of("a")), view.headers());
        assertNullRefused("method", () -> new RequestView(null, "/p", Map.of(), Optional.empty()));
        assertNullRefused("path", () -> new RequestView("GET", null, Map.of(), Optional.empty()));
        assertNullRefused("headers", () -> new RequestView("GET", "/p", null, Optional.empty()));
        assertNullRefused("clientAddress", () -> new RequestView("GET", "/p", Map.of(), null));
    }

    @Test
    void resultAndDecisionArmsRefuseNullDenials() {
        assertNullRefused("deny", () -> new Decision.Denied<ErrorCodeWithParams>(null));
        assertNullRefused("deny", () -> new AuthenticateResult.Denied<String, ErrorCodeWithParams>(null));
        assertNullRefused("principal", () -> new AuthenticateResult.Authenticated<String, ErrorCodeWithParams>(null));
        assertNullRefused("deny", () -> new ScopeResolution.Denied<ResolvedScope<String, String>, ErrorCodeWithParams>(null));
        assertNullRefused("resolved", () -> new ScopeResolution.Resolved<ResolvedScope<String, String>, ErrorCodeWithParams>(null));
        assertNullRefused("response", () -> new IdempotencyBegin.Replay(null));
    }

    @Test
    void purposesScopesAndClaimsRefuseNullPartsByName() {
        assertNullRefused("pointer", () -> new Purpose.Field(null, FieldDirection.OUTPUT));
        assertNullRefused("direction", () -> new Purpose.Field("/a", null));
        assertNullRefused("key", () -> new Purpose.SortKey(null));
        assertNullRefused("id", () -> new ScopeIdSource.Declared<String>(null));
        assertNullRefused("request", () -> new ScopeIdSource.Custom<String>(null));
        assertNullRefused("scope", () -> new ResolvedScope<String, String>(null, "id", Optional.empty()));
        assertNullRefused("id", () -> new ResolvedScope<String, String>("s", null, Optional.empty()));
        assertNullRefused("value", () -> new ResolvedScope<String, String>("s", "id", null));
        assertNullRefused("type", () -> new SubjectRef<String, String>(null, "id", Optional.empty()));
        assertNullRefused("key", () -> new IdempotencyClaim(null, "f", 1, new OperationRef("a", "o")));
        assertNullRefused("fingerprint", () -> new IdempotencyClaim("k", null, 1, new OperationRef("a", "o")));
        assertNullRefused("operation", () -> new IdempotencyClaim("k", "f", 1, null));
    }

    private static void assertNullRefused(String name, Supplier<Object> construction) {
        NullPointerException refusal = assertThrows(NullPointerException.class, construction::get);

        assertEquals(name, refusal.getMessage());
    }
}
