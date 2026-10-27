package com.example.tasks.api;

import com.example.tasks.api.schemas.UserPrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record AssignTaskInput(@Valid @NotNull AssignTaskPath path,
        @Valid @NotNull AssignTaskHeaders headers,
        com.example.tasks.api.schemas. @Valid @NotNull AssignTaskInput body,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) UserPrincipal principal,
        AssignTaskScopes scopes) {
    @Override
    public String toString() {
        return "AssignTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + ", principal=" + this.principal() + ", scopes=" + this.scopes() + "]";
    }
}
