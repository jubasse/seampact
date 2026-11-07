package io.github.jubasse.seampact.hooks;

import java.util.Optional;

/**
 * What the authenticate hook of one identity receives; the generated request record narrows each member.
 *
 * @param <Credentials> the credentials the identity's schemes declare
 * @param <Extensions> the operation's extension values
 */
public interface AuthenticateRequest<Credentials, Extensions> {
    /** The identity name. */
    String identity();

    /** The credentials found in the locations the identity's schemes declare for this request. */
    Credentials credentials();

    /** The CSRF companion value, on a write authenticated by a cookie scheme that declares {@code csrf}. */
    Optional<String> csrfToken();

    /** Present for a signed identity. */
    Optional<? extends SignedRequest> signature();

    /** A read-only view of the request. */
    RequestView request();

    /** The operation the hook is called for. */
    OperationRef operation();

    /** The operation's extension values. */
    Extensions extensions();
}
