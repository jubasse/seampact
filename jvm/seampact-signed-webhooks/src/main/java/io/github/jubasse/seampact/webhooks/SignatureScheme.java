package io.github.jubasse.seampact.webhooks;

import java.time.Duration;
import java.util.Objects;
import java.util.Optional;

/**
 * A template signature scheme (ADR 0013): the MAC algorithm, the signed payload template with its `{ts}` and
 * `{rawBody}` placeholders, the encoding, and the largest distance allowed between the signed timestamp and now. The
 * application copies it from the hook's signature template, tolerance included.
 *
 * @throws TimestampWithoutToleranceException when the payload holds `{ts}` and no tolerance is given
 */
public record SignatureScheme(String algorithm, String payload, SignatureEncoding encoding, Optional<Duration> tolerance) {
    public SignatureScheme {
        Objects.requireNonNull(algorithm, "algorithm");
        Objects.requireNonNull(payload, "payload");
        Objects.requireNonNull(encoding, "encoding");
        Objects.requireNonNull(tolerance, "tolerance");
        if (tolerance.isEmpty() && payload.contains(TemplateSignatureVerifier.TIMESTAMP_PLACEHOLDER)) {
            throw new TimestampWithoutToleranceException(payload);
        }
    }

    /** A scheme with no timestamp tolerance. */
    public SignatureScheme(String algorithm, String payload, SignatureEncoding encoding) {
        this(algorithm, payload, encoding, Optional.empty());
    }
}
