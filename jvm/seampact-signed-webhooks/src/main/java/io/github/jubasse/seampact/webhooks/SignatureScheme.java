package io.github.jubasse.seampact.webhooks;

import java.time.Duration;
import java.util.Objects;
import java.util.Optional;

/**
 * A template signature scheme (ADR 0013): the MAC algorithm, the signed payload template with its `{ts}` and
 * `{rawBody}` placeholders, the encoding, and the largest distance allowed between the signed timestamp and now. The
 * application copies it from the hook's signature template, tolerance included.
 *
 * @throws SignaturePayloadInvalidException when the payload does not hold `{rawBody}` exactly once and `{ts}` at
 *     most once
 * @throws TimestampWithoutToleranceException when the payload holds `{ts}` and no tolerance is given
 * @throws SignatureToleranceInvalidException when the tolerance is negative or the payload holds no `{ts}`
 */
public record SignatureScheme(String algorithm, String payload, SignatureEncoding encoding, Optional<Duration> tolerance) {
    public SignatureScheme {
        Objects.requireNonNull(algorithm, "algorithm");
        Objects.requireNonNull(payload, "payload");
        Objects.requireNonNull(encoding, "encoding");
        Objects.requireNonNull(tolerance, "tolerance");

        int rawBodyCount = occurrences(payload, TemplateSignatureVerifier.RAW_BODY_PLACEHOLDER);
        int timestampCount = occurrences(payload, TemplateSignatureVerifier.TIMESTAMP_PLACEHOLDER);
        if (rawBodyCount != 1 || timestampCount > 1) throw new SignaturePayloadInvalidException(payload);

        if (tolerance.isEmpty() && timestampCount == 1) throw new TimestampWithoutToleranceException(payload);
        if (tolerance.isPresent() && tolerance.get().isNegative()) throw SignatureToleranceInvalidException.negative(tolerance.get());
        if (tolerance.isPresent() && timestampCount == 0) throw SignatureToleranceInvalidException.withoutTimestamp(payload);
    }

    /** A scheme with no timestamp tolerance. */
    public SignatureScheme(String algorithm, String payload, SignatureEncoding encoding) {
        this(algorithm, payload, encoding, Optional.empty());
    }

    private static int occurrences(String text, String placeholder) {
        int count = 0;
        for (int at = text.indexOf(placeholder); at >= 0; at = text.indexOf(placeholder, at + placeholder.length())) count++;

        return count;
    }
}
