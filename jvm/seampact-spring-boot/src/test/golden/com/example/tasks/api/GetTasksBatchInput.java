package com.example.tasks.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public record GetTasksBatchInput(@Valid @NotNull GetTasksBatchPath path,
        @Valid @NotNull GetTasksBatchHeaders headers,
        com.example.tasks.api.schemas. @Valid @NotNull GetTasksBatchInput body) {
    @Override
    public String toString() {
        return "GetTasksBatchInput[path=" + path() + ", headers=" + headers() + ", body=" + body() + "]";
    }
}
