package io.github.jubasse.seampact.webhooks;

/** The scheme signs `{ts}` without a tolerance (ADR 0013 requires one): a replay of any age would pass. */
public final class TimestampWithoutToleranceException extends IllegalArgumentException {
    /** The code every ecosystem's helper uses for this refusal. */
    public static final String CODE = "signature.tolerance.invalid";

    private static final long serialVersionUID = 1L;

    public TimestampWithoutToleranceException(String payload) {
        super("The signed payload '" + payload + "' holds {ts} but the scheme has no tolerance, so a replayed request "
            + "of any age would pass. Pass the tolerance of the hook's signature template.");
    }
}
