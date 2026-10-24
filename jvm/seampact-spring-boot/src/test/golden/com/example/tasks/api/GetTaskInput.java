package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetTaskInput(@Valid @NotNull GetTaskPath path,
        @Valid @NotNull GetTaskHeaders headers) {
    @Override
    public String toString() {
        return "GetTaskInput[path=" + this.path() + ", headers=" + this.headers() + "]";
    }
}
