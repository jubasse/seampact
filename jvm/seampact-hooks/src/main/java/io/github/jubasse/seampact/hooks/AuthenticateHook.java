package io.github.jubasse.seampact.hooks;

/**
 * One per identity; called only when a declared credential is present.
 *
 * @param <Request> the identity's generated request record
 * @param <Principal> the identity's principal
 * @param <Denial> the identity's declared codes
 */
public interface AuthenticateHook<
        Request extends AuthenticateRequest<?, ?>, Principal, Denial extends ErrorCodeWithParams> {
    AuthenticateResult<Principal, Denial> authenticate(Request request);
}
