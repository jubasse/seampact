package io.github.jubasse.seampact.hooks;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class RedactedToStringTest {
    private static final String SECRET = "s3cret-value";
    private static final byte[] SECRET_BYTES = SECRET.getBytes(StandardCharsets.UTF_8);

    @Test
    void requestViewHidesHeaderValues() {
        RequestView view = new RequestView(
                "GET", "/orders", Map.of("authorization", List.of(SECRET)), Optional.of("203.0.113.7"));

        assertFalse(view.toString().contains(SECRET));
        assertTrue(view.toString().contains("/orders"));
    }

    @Test
    void storedResponseHidesBodyAndHeaderValues() {
        StoredResponse response = new StoredResponse(
                200, List.of(new StoredResponse.Header("set-cookie", SECRET)), SECRET_BYTES);

        assertFalse(response.toString().contains(SECRET));
        assertTrue(response.toString().contains("set-cookie"));
    }

    @Test
    void signedRequestsHideBodyAndSignatures() {
        SignatureTemplate template = new SignatureTemplate(
                "hmac-sha256", "{ts}.{body}", SignatureEncoding.HEX, Optional.empty());
        SignedTemplateRequest templated = new SignedTemplateRequest(
                SECRET_BYTES, Optional.of("1"), List.of(SECRET), "key-1", template);

        assertFalse(templated.toString().contains(SECRET));
        assertTrue(templated.toString().contains("key-1"));
    }
}
