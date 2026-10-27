package com.example.tasks.api;

import com.example.tasks.api.schemas.WebhookCaller;
import io.github.jubasse.seampact.hooks.AuthenticateHook;
import io.github.jubasse.seampact.springboot.runtime.Denial;

/**
 * The authenticate hook of the identity 'stripe': register one bean implementing it.
 */
public interface StripeAuthenticateHook extends AuthenticateHook<StripeAuthenticateRequest, WebhookCaller, Denial> {
}
