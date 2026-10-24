package com.example.tasks.api;

import com.example.tasks.api.schemas.UserPrincipal;
import com.example.tasks.api.spring.runtime.Denial;
import io.github.jubasse.seampact.hooks.AuthenticateHook;

/**
 * The authenticate hook of the identity 'user': register one bean implementing it.
 */
public interface UserAuthenticateHook extends AuthenticateHook<UserAuthenticateRequest, UserPrincipal, Denial> {
}
