package com.example.tasks.api;

import com.example.tasks.api.schemas.UserPrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetTasksBatchInput(@Valid @NotNull GetTasksBatchPath path,
        @Valid @NotNull GetTasksBatchHeaders headers,
        com.example.tasks.api.schemas. @Valid @NotNull GetTasksBatchInput body,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) UserPrincipal principal,
        GetTasksBatchScopes scopes) {
    @Override
    public String toString() {
        return "GetTasksBatchInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + ", principal=" + this.principal() + ", scopes=" + this.scopes() + "]";
    }
}
