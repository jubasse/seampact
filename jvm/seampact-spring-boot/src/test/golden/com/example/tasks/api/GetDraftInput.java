package com.example.tasks.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public record GetDraftInput(@Valid @NotNull GetDraftPath path,
        @Valid @NotNull GetDraftHeaders headers) {
    @Override
    public String toString() {
        return "GetDraftInput[path=" + path() + ", headers=" + headers() + "]";
    }
}
