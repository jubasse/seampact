package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetTasksBatchInput(@Valid @NotNull GetTasksBatchPath path,
        @Valid @NotNull GetTasksBatchHeaders headers,
        com.example.tasks.api.schemas. @Valid @NotNull GetTasksBatchInput body) {
    @Override
    public String toString() {
        return "GetTasksBatchInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + "]";
    }
}
