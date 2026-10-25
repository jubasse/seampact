package io.github.jubasse.seampact.webhooks;

/**
 * The signed payload does not hold `{rawBody}` exactly once and `{ts}` at most once (grammar section 09): a payload
 * without the body would let one captured signature pass with any body.
 */
public final class SignaturePayloadInvalidException extends IllegalArgumentException {
    /** The code every ecosystem's helper uses for this refusal. */
    public static final String CODE = "signature.payload.invalid";

    private static final long serialVersionUID = 1L;

    public SignaturePayloadInvalidException(String payload) {
        super("The signed payload '" + payload + "' must hold {rawBody} exactly once and {ts} at most once, or a "
            + "captured signature could pass with another body. Copy the payload of the hook's signature template.");
    }
}
