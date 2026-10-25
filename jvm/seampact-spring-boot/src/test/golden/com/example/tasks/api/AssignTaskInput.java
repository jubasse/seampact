package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record AssignTaskInput(@Valid @NotNull AssignTaskPath path,
        @Valid @NotNull AssignTaskHeaders headers,
        com.example.tasks.api.schemas. @Valid @NotNull AssignTaskInput body) {
    @Override
    public String toString() {
        return "AssignTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + "]";
    }
}
