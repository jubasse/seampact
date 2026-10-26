package io.github.jubasse.seampact.webhooks;

import java.time.Duration;

/**
 * The scheme's tolerance is negative, which refuses every request, or is given for a payload that signs no `{ts}`
 * (grammar section 09 refuses both).
 */
public final class SignatureToleranceInvalidException extends IllegalArgumentException {
    /** The code every ecosystem's helper uses for this refusal. */
    public static final String CODE = "signature.tolerance.invalid";

    private static final long serialVersionUID = 1L;

    private SignatureToleranceInvalidException(String message) {
        super(message);
    }

    static SignatureToleranceInvalidException negative(Duration tolerance) {
        return new SignatureToleranceInvalidException("The tolerance " + tolerance + " is negative, so every request "
            + "would fail. Pass the tolerance of the hook's signature template.");
    }

    static SignatureToleranceInvalidException withoutTimestamp(String payload) {
        return new SignatureToleranceInvalidException("The scheme has a tolerance but its signed payload '" + payload
            + "' holds no {ts}, so there is no timestamp to check. Drop the tolerance, as the hook's signature template does.");
    }
}
