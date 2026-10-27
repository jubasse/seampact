package com.example.optins.api;

import com.example.optins.api.schemas.ServicePrincipal;
import io.github.jubasse.seampact.hooks.AuthenticateHook;
import io.github.jubasse.seampact.springboot.runtime.Denial;

/**
 * The authenticate hook of the identity 'service': register one bean implementing it.
 */
public interface ServiceAuthenticateHook extends AuthenticateHook<ServiceAuthenticateRequest, ServicePrincipal, Denial> {
}
