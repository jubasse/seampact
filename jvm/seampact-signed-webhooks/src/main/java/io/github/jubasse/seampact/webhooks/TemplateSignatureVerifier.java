package io.github.jubasse.seampact.webhooks;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Verifies a template-signed request (ADR 0013 "Where the verification happens"): rebuilds the signed payload from
 * the raw bytes, computes the MAC with each valid secret, decodes each candidate, compares them in constant time
 * ({@link MessageDigest#isEqual}), then checks the timestamp against the tolerance in both directions. The clock is
 * injectable for tests; the secrets come from the lookup on each call and are never kept.
 */
public final class TemplateSignatureVerifier {
    /** The only MAC this verifier computes; the IR enum is open, so another algorithm is refused by name. */
    public static final String SUPPORTED_ALGORITHM = "hmac-sha256";

    private static final String MAC_ALGORITHM = "HmacSHA256";
    private static final int HMAC_SHA256_BYTES = 32;
    /** The signed timestamp placeholder of a payload template. */
    public static final String TIMESTAMP_PLACEHOLDER = "{ts}";

    static final String RAW_BODY_PLACEHOLDER = "{rawBody}";
    private static final BigInteger MILLISECONDS_PER_SECOND = BigInteger.valueOf(1000);
    private static final Pattern UNIX_SECONDS = Pattern.compile("[0-9]+");
    private static final Pattern HEX = Pattern.compile("(?:[0-9a-fA-F]{2})+");
    private static final Pattern BASE64 = Pattern.compile("(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?");

    private final SecretLookup secretLookup;
    private final Clock clock;

    public TemplateSignatureVerifier(SecretLookup secretLookup, Clock clock) {
        this.secretLookup = Objects.requireNonNull(secretLookup, "secretLookup");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    /** A verifier on the system clock. */
    public TemplateSignatureVerifier(SecretLookup secretLookup) {
        this(secretLookup, Clock.systemUTC());
    }

    /**
     * @param rawBody the decoded body bytes, exactly as received
     * @param timestamp the signed timestamp text as received, empty when the header carries none
     * @param candidateSignatures every signature the header carries, still encoded
     * @throws UnsupportedSignatureAlgorithmException when the scheme names another algorithm than hmac-sha256
     * @throws EmptySignatureSecretException when the lookup returns an empty or null secret
     */
    public SignatureVerification verify(
        byte[] rawBody,
        Optional<String> timestamp,
        List<String> candidateSignatures,
        String keyId,
        SignatureScheme scheme
    ) {
        if (!SUPPORTED_ALGORITHM.equals(scheme.algorithm())) throw new UnsupportedSignatureAlgorithmException(scheme.algorithm());

        boolean signsTimestamp = scheme.payload().contains(TIMESTAMP_PLACEHOLDER);
        if (signsTimestamp && timestamp.isEmpty()) return SignatureVerification.failed(SignatureFailure.TIMESTAMP_MISSING);

        List<byte[]> lookedUp = Objects.requireNonNull(secretLookup.secretsFor(keyId), "The SecretLookup returned null; return an empty list for an unknown key id.");
        List<byte[]> secrets = usableSecrets(lookedUp, keyId);
        if (secrets.isEmpty()) return SignatureVerification.failed(SignatureFailure.NO_SECRET);

        byte[] payload = signedPayload(scheme.payload(), rawBody, timestamp.orElse(""));
        List<byte[]> candidates = decodedCandidates(candidateSignatures, scheme.encoding());
        if (!anySecretMatches(secrets, payload, candidates)) return SignatureVerification.failed(SignatureFailure.SIGNATURE_MISMATCH);

        return timestampFailure(timestamp, scheme.tolerance())
            .map(SignatureVerification::failed)
            .orElseGet(SignatureVerification::verified);
    }

    // Before any hashing, so an unusable secret never reaches the MAC.
    private static List<byte[]> usableSecrets(List<byte[]> secrets, String keyId) {
        for (int index = 0; index < secrets.size(); index++) {
            byte[] secret = secrets.get(index);
            if (secret == null || secret.length == 0) throw new EmptySignatureSecretException(keyId, index);
        }

        return List.copyOf(secrets);
    }

    // The payload template with `{ts}` replaced by the timestamp text as received and `{rawBody}`, which the scheme
    // holds exactly once, by the raw bytes.
    private static byte[] signedPayload(String template, byte[] rawBody, String timestamp) {
        int bodyAt = template.indexOf(RAW_BODY_PLACEHOLDER);
        String beforeBody = template.substring(0, bodyAt);
        String afterBody = template.substring(bodyAt + RAW_BODY_PLACEHOLDER.length());

        ByteArrayOutputStream payload = new ByteArrayOutputStream();
        payload.writeBytes(beforeBody.replace(TIMESTAMP_PLACEHOLDER, timestamp).getBytes(StandardCharsets.UTF_8));
        payload.writeBytes(rawBody);
        payload.writeBytes(afterBody.replace(TIMESTAMP_PLACEHOLDER, timestamp).getBytes(StandardCharsets.UTF_8));

        return payload.toByteArray();
    }

    // A candidate that does not decode in the declared encoding, or decodes to the wrong length, never matches.
    private static List<byte[]> decodedCandidates(List<String> candidateSignatures, SignatureEncoding encoding) {
        List<byte[]> decodedCandidates = new ArrayList<>();
        for (String candidate : candidateSignatures) {
            decodeCandidate(candidate, encoding)
                .filter(decoded -> decoded.length == HMAC_SHA256_BYTES)
                .ifPresent(decodedCandidates::add);
        }

        return decodedCandidates;
    }

    private static Optional<byte[]> decodeCandidate(String candidate, SignatureEncoding encoding) {
        return switch (encoding) {
            case HEX -> HEX.matcher(candidate).matches() ? Optional.of(HexFormat.of().parseHex(candidate)) : Optional.empty();
            case BASE64 -> BASE64.matcher(candidate).matches() ? Optional.of(Base64.getDecoder().decode(candidate)) : Optional.empty();
        };
    }

    // Every secret against every candidate, without stopping at the first match.
    private static boolean anySecretMatches(List<byte[]> secrets, byte[] payload, List<byte[]> candidates) {
        boolean matched = false;
        for (byte[] secret : secrets) {
            byte[] expected = hmacSha256(secret, payload);
            for (byte[] candidate : candidates) {
                if (MessageDigest.isEqual(expected, candidate)) matched = true;
            }
        }

        return matched;
    }

    private static byte[] hmacSha256(byte[] secret, byte[] payload) {
        try {
            Mac mac = Mac.getInstance(MAC_ALGORITHM);
            mac.init(new SecretKeySpec(secret, MAC_ALGORITHM));

            return mac.doFinal(payload);
        } catch (NoSuchAlgorithmException | InvalidKeyException unavailable) {
            // Every Java SE runtime provides HmacSHA256, and a non-empty key is always valid for it.
            throw new IllegalStateException("This Java runtime cannot compute HmacSHA256: " + unavailable.getMessage(), unavailable);
        }
    }

    private Optional<SignatureFailure> timestampFailure(Optional<String> timestamp, Optional<Duration> tolerance) {
        if (tolerance.isEmpty()) return Optional.empty();
        if (timestamp.isEmpty()) return Optional.of(SignatureFailure.TIMESTAMP_MISSING);
        if (!UNIX_SECONDS.matcher(timestamp.get()).matches()) return Optional.of(SignatureFailure.TIMESTAMP_MALFORMED);

        // Exact arithmetic, so a timestamp too long for a long lands outside any tolerance instead of overflowing.
        BigInteger signedAtMilliseconds = new BigInteger(timestamp.get()).multiply(MILLISECONDS_PER_SECOND);
        BigInteger distance = BigInteger.valueOf(clock.millis()).subtract(signedAtMilliseconds).abs();
        if (distance.compareTo(BigInteger.valueOf(tolerance.get().toMillis())) > 0) {
            return Optional.of(SignatureFailure.TIMESTAMP_OUTSIDE_TOLERANCE);
        }

        return Optional.empty();
    }
}
