package com.example.tasks.api;

import com.example.tasks.api.schemas.CreateTask;
import com.example.tasks.api.schemas.UserPrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record CreateTaskInput(@Valid @NotNull CreateTaskPath path,
        @Valid @NotNull CreateTaskHeaders headers, @Valid @NotNull CreateTask body,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) UserPrincipal principal,
        CreateTaskScopes scopes) {
    @Override
    public String toString() {
        return "CreateTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + ", principal=" + this.principal() + ", scopes=" + this.scopes() + "]";
    }
}
