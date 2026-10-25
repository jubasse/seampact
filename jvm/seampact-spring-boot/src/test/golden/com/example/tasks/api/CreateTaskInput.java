package com.example.tasks.api;

import com.example.tasks.api.schemas.CreateTask;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record CreateTaskInput(@Valid @NotNull CreateTaskPath path,
        @Valid @NotNull CreateTaskHeaders headers, @Valid @NotNull CreateTask body) {
    @Override
    public String toString() {
        return "CreateTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + "]";
    }
}
