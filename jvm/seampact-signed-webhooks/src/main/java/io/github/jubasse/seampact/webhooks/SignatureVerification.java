package io.github.jubasse.seampact.webhooks;

import java.util.Objects;
import java.util.Optional;

/** The verifier's answer: verified, or the failure that refused the request. */
public final class SignatureVerification {
    private static final SignatureVerification VERIFIED = new SignatureVerification(null);

    private final SignatureFailure failure;

    private SignatureVerification(SignatureFailure failure) {
        this.failure = failure;
    }

    public static SignatureVerification verified() {
        return VERIFIED;
    }

    public static SignatureVerification failed(SignatureFailure failure) {
        return new SignatureVerification(Objects.requireNonNull(failure, "failure"));
    }

    public boolean isVerified() {
        return failure == null;
    }

    /** Why the request was refused; empty when it is verified. */
    public Optional<SignatureFailure> failure() {
        return Optional.ofNullable(failure);
    }

    @Override
    public String toString() {
        return failure == null ? "SignatureVerification[verified]" : "SignatureVerification[" + failure.code() + "]";
    }
}
