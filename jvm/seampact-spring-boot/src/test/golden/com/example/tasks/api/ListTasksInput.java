package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ListTasksInput(@Valid @NotNull ListTasksPath path,
        @Valid @NotNull ListTasksQuery query, @Valid @NotNull ListTasksHeaders headers) {
    @Override
    public String toString() {
        return "ListTasksInput[path=" + this.path() + ", query=" + this.query() + ", headers=" + this.headers() + "]";
    }
}
