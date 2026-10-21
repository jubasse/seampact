package com.example.tasks.api;

import io.github.jubasse.seampact.hooks.AuthenticateRequest;
import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.RequestView;
import io.github.jubasse.seampact.hooks.SignedRequest;
import java.util.Map;
import java.util.Optional;

public record UserAuthenticateRequest(UserCredentials credentials, Optional<String> csrfToken,
        RequestView request, OperationRef operation,
        Map<String, Object> extensions) implements AuthenticateRequest<UserCredentials, Map<String, Object>> {
    @Override
    public String toString() {
        return "UserAuthenticateRequest[credentials=" + TasksRedaction.REDACTED + ", csrfToken=" + TasksRedaction.REDACTED + ", request=" + request() + ", operation=" + operation() + ", extensions=" + extensions() + "]";
    }

    @Override
    public String identity() {
        return "user";
    }

    @Override
    public Optional<SignedRequest> signature() {
        return Optional.empty();
    }
}
