package com.example.tasks.api;

import com.example.tasks.api.schemas.UpdateTask;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record UpdateTaskInput(@Valid @NotNull UpdateTaskPath path,
        @Valid @NotNull UpdateTaskHeaders headers, @Valid @NotNull UpdateTask body) {
    @Override
    public String toString() {
        return "UpdateTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + "]";
    }
}
