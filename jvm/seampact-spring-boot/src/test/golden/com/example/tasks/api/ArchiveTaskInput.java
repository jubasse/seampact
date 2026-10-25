package com.example.tasks.api;

import com.example.tasks.api.schemas.ArchiveTask;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ArchiveTaskInput(@Valid @NotNull ArchiveTaskPath path,
        @Valid @NotNull ArchiveTaskHeaders headers, @Valid @NotNull ArchiveTask body) {
    @Override
    public String toString() {
        return "ArchiveTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + "]";
    }
}
