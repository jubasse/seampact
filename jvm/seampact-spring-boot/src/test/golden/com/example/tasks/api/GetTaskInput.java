package com.example.tasks.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public record GetTaskInput(@Valid @NotNull GetTaskPath path,
        @Valid @NotNull GetTaskHeaders headers) {
    @Override
    public String toString() {
        return "GetTaskInput[path=" + path() + ", headers=" + headers() + "]";
    }
}
