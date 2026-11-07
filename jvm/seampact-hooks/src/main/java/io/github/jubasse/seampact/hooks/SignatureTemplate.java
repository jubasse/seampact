package io.github.jubasse.seampact.hooks;

import java.util.Objects;
import java.util.Optional;

/**
 * How a template scheme signs, copied from the scheme's {@code signature} so a helper needs only a secret lookup.
 *
 * @param algorithm the signing algorithm
 * @param payload the signed bytes, a template with {@code {rawBody}} and at most one {@code {ts}}
 * @param encoding how the signature is encoded
 * @param toleranceMs present exactly when the payload signs {@code {ts}}
 */
public record SignatureTemplate(
        String algorithm, String payload, SignatureEncoding encoding, Optional<Long> toleranceMs) {
    public SignatureTemplate {
        Objects.requireNonNull(algorithm, "algorithm");
        Objects.requireNonNull(payload, "payload");
        Objects.requireNonNull(encoding, "encoding");
        Objects.requireNonNull(toleranceMs, "toleranceMs");
    }
}
