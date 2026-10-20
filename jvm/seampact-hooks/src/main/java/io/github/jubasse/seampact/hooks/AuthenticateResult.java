package io.github.jubasse.seampact.hooks;

import java.util.Objects;

/**
 * A principal, or a denial naming one of the identity's declared codes: exactly one of the two.
 *
 * @param <Principal> the identity's principal
 * @param <Denial> the identity's declared codes
 */
public sealed interface AuthenticateResult<Principal, Denial extends ErrorCodeWithParams>
        permits AuthenticateResult.Authenticated, AuthenticateResult.Denied {
    /**
     * The caller is authenticated.
     *
     * @param principal the validated principal
     */
    record Authenticated<Principal, Denial extends ErrorCodeWithParams>(Principal principal)
            implements AuthenticateResult<Principal, Denial> {
        public Authenticated {
            Objects.requireNonNull(principal, "principal");
        }
    }

    /**
     * The credential is refused.
     *
     * @param deny one of the identity's declared codes
     */
    record Denied<Principal, Denial extends ErrorCodeWithParams>(Denial deny)
            implements AuthenticateResult<Principal, Denial> {
        public Denied {
            Objects.requireNonNull(deny, "deny");
        }
    }
}
