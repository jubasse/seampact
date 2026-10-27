package com.example.tasks.api;

import com.example.tasks.api.schemas.UserPrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ListTasksInput(@Valid @NotNull ListTasksPath path,
        @Valid @NotNull ListTasksQuery query, @Valid @NotNull ListTasksHeaders headers,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) UserPrincipal principal,
        ListTasksScopes scopes) {
    @Override
    public String toString() {
        return "ListTasksInput[path=" + this.path() + ", query=" + this.query() + ", headers=" + this.headers() + ", principal=" + this.principal() + ", scopes=" + this.scopes() + "]";
    }
}
