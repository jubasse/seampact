package com.example.optins.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import io.github.jubasse.seampact.hooks.AuthenticateRequest;
import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.RequestView;
import io.github.jubasse.seampact.hooks.SignedTemplateRequest;
import java.util.Map;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record StripeAuthenticateRequest(StripeCredentials credentials, Optional<String> csrfToken,
        Optional<SignedTemplateRequest> signature, RequestView request, OperationRef operation,
        Map<String, Object> extensions) implements AuthenticateRequest<StripeCredentials, Map<String, Object>> {
    @Override
    public String toString() {
        return "StripeAuthenticateRequest[credentials=" + TasksServiceRedaction.REDACTED + ", csrfToken=" + TasksServiceRedaction.REDACTED + ", signature=" + TasksServiceRedaction.REDACTED + ", request=" + this.request() + ", operation=" + this.operation() + ", extensions=" + this.extensions() + "]";
    }

    @Override
    public String identity() {
        return "stripe";
    }
}
