package io.github.jubasse.seampact.hooks;

import java.util.Objects;

/**
 * Allow, or a denial naming one of the requirement's declared codes with that code's params: exactly one of the two.
 *
 * @param <Codes> the codes the requirement declares
 */
public sealed interface Decision<Codes extends ErrorCodeWithParams> permits Decision.Allowed, Decision.Denied {
    /** The requirement is met. */
    record Allowed<Codes extends ErrorCodeWithParams>() implements Decision<Codes> {}

    /**
     * The requirement is not met.
     *
     * @param deny one of the requirement's declared codes, with its params
     */
    record Denied<Codes extends ErrorCodeWithParams>(Codes deny) implements Decision<Codes> {
        public Denied {
            Objects.requireNonNull(deny, "deny");
        }
    }
}
