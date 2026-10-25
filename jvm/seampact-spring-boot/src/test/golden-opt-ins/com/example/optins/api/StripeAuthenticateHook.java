package com.example.optins.api;

import com.example.optins.api.schemas.WebhookCaller;
import com.example.optins.api.spring.runtime.Denial;
import io.github.jubasse.seampact.hooks.AuthenticateHook;

/**
 * The authenticate hook of the identity 'stripe': register one bean implementing it.
 */
public interface StripeAuthenticateHook extends AuthenticateHook<StripeAuthenticateRequest, WebhookCaller, Denial> {
}
