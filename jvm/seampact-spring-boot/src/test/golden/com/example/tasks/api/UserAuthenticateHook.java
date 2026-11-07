package com.example.tasks.api;

import com.example.tasks.api.schemas.UserPrincipal;
import io.github.jubasse.seampact.hooks.AuthenticateHook;
import io.github.jubasse.seampact.springboot.runtime.Denial;

/**
 * The authenticate hook of the identity 'user': register one bean implementing it.
 */
public interface UserAuthenticateHook extends AuthenticateHook<UserAuthenticateRequest, UserPrincipal, Denial> {
}
