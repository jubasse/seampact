package io.github.jubasse.seampact.webhooks;

/** Why a signature failed; the authenticate hook answers its declared 401 for each of them. */
public enum SignatureFailure {
    NO_SECRET("no-secret"),
    TIMESTAMP_MISSING("timestamp-missing"),
    TIMESTAMP_MALFORMED("timestamp-malformed"),
    TIMESTAMP_OUTSIDE_TOLERANCE("timestamp-outside-tolerance"),
    SIGNATURE_MISMATCH("signature-mismatch");

    private final String code;

    SignatureFailure(String code) {
        this.code = code;
    }

    /** The code every ecosystem's helper uses for this failure. */
    public String code() {
        return code;
    }
}
