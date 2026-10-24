package com.example.tasksservice.api;

import com.example.tasksservice.api.schemas.ServicePrincipal;
import com.example.tasksservice.api.spring.runtime.Denial;
import io.github.jubasse.seampact.hooks.AuthenticateHook;

/**
 * The authenticate hook of the identity 'service': register one bean implementing it.
 */
public interface ServiceAuthenticateHook extends AuthenticateHook<ServiceAuthenticateRequest, ServicePrincipal, Denial> {
}
