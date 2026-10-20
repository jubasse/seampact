package io.github.jubasse.seampact.hooks;

import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * A request to a template scheme: the boundary has parsed the signature header but verified nothing.
 *
 * @param rawBody the body exactly as received, never re-serialized
 * @param timestamp the {@code {ts}} text as received, so the payload is rebuilt byte for byte; empty when the
 *     format has no {@code {ts}}
 * @param candidateSignatures every {@code {sig}} value the header carries, still encoded
 * @param keyId the key id from the scheme's {@code key}, which chooses the secret set
 * @param template how the scheme signs
 */
public record SignedTemplateRequest(
        byte[] rawBody,
        Optional<String> timestamp,
        List<String> candidateSignatures,
        String keyId,
        SignatureTemplate template)
        implements SignedRequest {
    public SignedTemplateRequest {
        rawBody = Objects.requireNonNull(rawBody, "rawBody").clone();
        Objects.requireNonNull(timestamp, "timestamp");
        candidateSignatures = List.copyOf(Objects.requireNonNull(candidateSignatures, "candidateSignatures"));
        Objects.requireNonNull(keyId, "keyId");
        Objects.requireNonNull(template, "template");
    }

    /** A copy, so the request stays unchanged. */
    @Override
    public byte[] rawBody() {
        return rawBody.clone();
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof SignedTemplateRequest that
                && Arrays.equals(rawBody, that.rawBody)
                && timestamp.equals(that.timestamp)
                && candidateSignatures.equals(that.candidateSignatures)
                && keyId.equals(that.keyId)
                && template.equals(that.template);
    }

    @Override
    public int hashCode() {
        return Objects.hash(Arrays.hashCode(rawBody), timestamp, candidateSignatures, keyId, template);
    }

    /** The body and the signatures are never shown. */
    @Override
    public String toString() {
        return "SignedTemplateRequest[rawBody=" + Redaction.REDACTED + ", timestamp=" + timestamp
                + ", candidateSignatures=" + Redaction.REDACTED + ", keyId=" + keyId + ", template=" + template + "]";
    }
}
