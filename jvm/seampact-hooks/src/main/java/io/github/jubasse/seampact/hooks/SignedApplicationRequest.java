package io.github.jubasse.seampact.hooks;

import java.util.Arrays;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * A request to a {@code verify: application} scheme: the hook verifies with its own library.
 *
 * @param rawBody the body exactly as received, never re-serialized
 * @param signatureHeader the signature header value, unparsed
 * @param headers the scheme's declared headers by lower-case name, unparsed; a header the request lacks is absent
 * @param keyId the key id from the scheme's {@code key}, when it declares one
 */
public record SignedApplicationRequest(
        byte[] rawBody, String signatureHeader, Map<String, String> headers, Optional<String> keyId)
        implements SignedRequest {
    public SignedApplicationRequest {
        rawBody = Objects.requireNonNull(rawBody, "rawBody").clone();
        Objects.requireNonNull(signatureHeader, "signatureHeader");
        headers = Map.copyOf(Objects.requireNonNull(headers, "headers"));
        Objects.requireNonNull(keyId, "keyId");
    }

    /** A copy, so the request stays unchanged. */
    @Override
    public byte[] rawBody() {
        return rawBody.clone();
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof SignedApplicationRequest that
                && Arrays.equals(rawBody, that.rawBody)
                && signatureHeader.equals(that.signatureHeader)
                && headers.equals(that.headers)
                && keyId.equals(that.keyId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(Arrays.hashCode(rawBody), signatureHeader, headers, keyId);
    }

    /** The body, the signature header and the declared headers are never shown. */
    @Override
    public String toString() {
        return "SignedApplicationRequest[rawBody=" + Redaction.REDACTED + ", signatureHeader=" + Redaction.REDACTED
                + ", headers=" + Redaction.REDACTED + ", keyId=" + keyId + "]";
    }
}
