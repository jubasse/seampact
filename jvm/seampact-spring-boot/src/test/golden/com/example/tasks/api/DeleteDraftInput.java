package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record DeleteDraftInput(@Valid @NotNull DeleteDraftPath path,
        @Valid @NotNull DeleteDraftHeaders headers) {
    @Override
    public String toString() {
        return "DeleteDraftInput[path=" + this.path() + ", headers=" + this.headers() + "]";
    }
}
