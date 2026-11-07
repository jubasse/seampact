package io.github.jubasse.seampact.webhooks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;
import kotlinx.serialization.json.Json;
import kotlinx.serialization.json.JsonElement;
import kotlinx.serialization.json.JsonElementKt;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

// The ADR 0013 test vectors every ecosystem's helper passes, read from the npm package's vector file.
class VectorsTest {
    private static final String VECTORS_PATH = "packages/runtime/signed-webhooks/vectors/adr-0013.json";
    private static final String KEY_ID = "test";
    private static final String PASS = "pass";
    private static final String REFUSED = "401";
    private static final String TIMESTAMP_PLACEHOLDER = "{ts}";
    private static final String SIGNATURE_PLACEHOLDER = "{sig}";
    private static final long MILLISECONDS_PER_SECOND = 1000;

    // Why each 401 vector fails: a wrong MAC, or a timestamp outside the tolerance.
    private static final Map<String, SignatureFailure> FAILURE_OF_VECTOR = Map.of(
        "G3", SignatureFailure.SIGNATURE_MISMATCH,
        "S3", SignatureFailure.TIMESTAMP_OUTSIDE_TOLERANCE,
        "S4", SignatureFailure.TIMESTAMP_OUTSIDE_TOLERANCE,
        "S5", SignatureFailure.SIGNATURE_MISMATCH,
        "S8", SignatureFailure.SIGNATURE_MISMATCH
    );

    record Vector(String id, Map<String, JsonElement> scheme, Map<String, JsonElement> testCase) {
        @Override
        public String toString() {
            return id;
        }
    }

    static Stream<Vector> vectors() throws IOException {
        Path file = Path.of(System.getProperty("seampact.repositoryRoot")).resolve(VECTORS_PATH);
        Map<String, JsonElement> root = JsonElementKt.getJsonObject(Json.Default.parseToJsonElement(Files.readString(file)));
        Map<String, JsonElement> schemes = JsonElementKt.getJsonObject(root.get("schemes"));

        return JsonElementKt.getJsonArray(root.get("cases")).stream().map(entry -> {
            Map<String, JsonElement> testCase = JsonElementKt.getJsonObject(entry);
            return new Vector(text(testCase, "id"), JsonElementKt.getJsonObject(schemes.get(text(testCase, "scheme"))), testCase);
        });
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("vectors")
    void passesTheVector(Vector vector) {
        HeaderFields header = parseHeader(text(vector.scheme(), "format"), text(vector.testCase(), "header"));
        List<byte[]> secrets = JsonElementKt.getJsonArray(vector.testCase().get("secrets")).stream()
            .map(secret -> JsonElementKt.getJsonPrimitive(secret).getContent().getBytes(StandardCharsets.UTF_8))
            .toList();
        long nowSeconds = vector.testCase().containsKey("nowSeconds") ? Long.parseLong(text(vector.testCase(), "nowSeconds")) : 0;
        TemplateSignatureVerifier verifier = new TemplateSignatureVerifier(keyId -> secrets, fixedClock(nowSeconds * MILLISECONDS_PER_SECOND));

        SignatureVerification verification = verifier.verify(
            text(vector.testCase(), "body").getBytes(StandardCharsets.UTF_8),
            header.timestamp(),
            header.candidates(),
            KEY_ID,
            scheme(vector.scheme())
        );

        assertEquals(text(vector.testCase(), "expected"), verification.isVerified() ? PASS : REFUSED);
        assertEquals(Optional.ofNullable(FAILURE_OF_VECTOR.get(vector.id())), verification.failure());
    }

    @Test
    void refusesAnEmptySecretByName() {
        TemplateSignatureVerifier verifier = new TemplateSignatureVerifier(keyId -> List.of(new byte[0]));

        EmptySignatureSecretException refused = assertThrows(
            EmptySignatureSecretException.class,
            () -> verifier.verify(new byte[0], Optional.empty(), List.of("00"), KEY_ID, githubScheme())
        );
        assertTrue(refused.getMessage().contains("'" + KEY_ID + "'"));
    }

    @Test
    void refusesANullSecretByItsPosition() {
        List<byte[]> secrets = new ArrayList<>();
        secrets.add("whsec_seampact_test_secret".getBytes(StandardCharsets.UTF_8));
        secrets.add(null);
        TemplateSignatureVerifier verifier = new TemplateSignatureVerifier(keyId -> secrets);

        EmptySignatureSecretException refused = assertThrows(
            EmptySignatureSecretException.class,
            () -> verifier.verify(new byte[0], Optional.empty(), List.of("00"), KEY_ID, githubScheme())
        );
        assertTrue(refused.getMessage().contains("position 1"));
    }

    @Test
    void refusesATimestampSchemeWithoutTolerance() {
        TimestampWithoutToleranceException refused = assertThrows(
            TimestampWithoutToleranceException.class,
            () -> new SignatureScheme(TemplateSignatureVerifier.SUPPORTED_ALGORITHM, "{ts}.{rawBody}", SignatureEncoding.HEX)
        );
        assertTrue(refused.getMessage().contains("'{ts}.{rawBody}'"));
        assertEquals("signature.tolerance.invalid", TimestampWithoutToleranceException.CODE);
    }

    @Test
    void refusesAnotherAlgorithmByName() {
        TemplateSignatureVerifier verifier = new TemplateSignatureVerifier(keyId -> List.of(new byte[] {1}));
        SignatureScheme sha512 = new SignatureScheme("hmac-sha512", "{rawBody}", SignatureEncoding.HEX);

        UnsupportedSignatureAlgorithmException refused = assertThrows(
            UnsupportedSignatureAlgorithmException.class,
            () -> verifier.verify(new byte[0], Optional.empty(), List.of(), KEY_ID, sha512)
        );
        assertTrue(refused.getMessage().contains("'hmac-sha512'"));
    }

    @Test
    void failsWithoutASecretForTheKey() {
        SignatureVerification verification = new TemplateSignatureVerifier(keyId -> List.of())
            .verify("Hello, World!".getBytes(StandardCharsets.UTF_8), Optional.empty(), List.of(), KEY_ID, githubScheme());

        assertEquals(Optional.of(SignatureFailure.NO_SECRET), verification.failure());
    }

    private record HeaderFields(Optional<String> timestamp, List<String> candidates) {
    }

    // The header's `key=value` pairs, matched against the format's `key={ts}` and `key={sig}` pairs; a repeated
    // signature key gives several candidates, and a key the format does not name is ignored.
    private static HeaderFields parseHeader(String format, String header) {
        String timestampKey = null;
        String signatureKey = null;
        for (String pair : format.split(",")) {
            String[] keyAndPlaceholder = pair.split("=", 2);
            if (keyAndPlaceholder[1].equals(TIMESTAMP_PLACEHOLDER)) timestampKey = keyAndPlaceholder[0];
            if (keyAndPlaceholder[1].equals(SIGNATURE_PLACEHOLDER)) signatureKey = keyAndPlaceholder[0];
        }

        Optional<String> timestamp = Optional.empty();
        List<String> candidates = new ArrayList<>();
        for (String pair : header.split(",")) {
            String[] keyAndValue = pair.split("=", 2);
            if (keyAndValue[0].equals(timestampKey)) timestamp = Optional.of(keyAndValue[1]);
            if (keyAndValue[0].equals(signatureKey)) candidates.add(keyAndValue[1]);
        }

        return new HeaderFields(timestamp, candidates);
    }

    private static SignatureScheme scheme(Map<String, JsonElement> scheme) {
        Optional<Duration> tolerance = scheme.containsKey("toleranceMs")
            ? Optional.of(Duration.ofMillis(Long.parseLong(text(scheme, "toleranceMs"))))
            : Optional.empty();

        return new SignatureScheme(text(scheme, "algorithm"), text(scheme, "payload"), SignatureEncoding.fromIrName(text(scheme, "encoding")), tolerance);
    }

    private static SignatureScheme githubScheme() {
        return new SignatureScheme(TemplateSignatureVerifier.SUPPORTED_ALGORITHM, "{rawBody}", SignatureEncoding.HEX);
    }

    private static Clock fixedClock(long nowMilliseconds) {
        return Clock.fixed(Instant.ofEpochMilli(nowMilliseconds), ZoneOffset.UTC);
    }

    private static String text(Map<String, JsonElement> object, String key) {
        return JsonElementKt.getJsonPrimitive(object.get(key)).getContent();
    }
}
