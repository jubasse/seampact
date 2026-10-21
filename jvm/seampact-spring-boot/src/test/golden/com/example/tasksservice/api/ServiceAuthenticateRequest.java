package com.example.tasksservice.api;

import io.github.jubasse.seampact.hooks.AuthenticateRequest;
import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.RequestView;
import io.github.jubasse.seampact.hooks.SignedRequest;
import java.util.Map;
import java.util.Optional;

public record ServiceAuthenticateRequest(ServiceCredentials credentials, Optional<String> csrfToken,
        RequestView request, OperationRef operation,
        Map<String, Object> extensions) implements AuthenticateRequest<ServiceCredentials, Map<String, Object>> {
    @Override
    public String toString() {
        return "ServiceAuthenticateRequest[credentials=" + TasksServiceRedaction.REDACTED + ", csrfToken=" + TasksServiceRedaction.REDACTED + ", request=" + request() + ", operation=" + operation() + ", extensions=" + extensions() + "]";
    }

    @Override
    public String identity() {
        return "service";
    }

    @Override
    public Optional<SignedRequest> signature() {
        return Optional.empty();
    }
}
