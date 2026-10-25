package com.example.optins.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record PeekTaskInput(@Valid @NotNull PeekTaskPath path,
        @Valid @NotNull PeekTaskHeaders headers) {
    @Override
    public String toString() {
        return "PeekTaskInput[path=" + this.path() + ", headers=" + this.headers() + "]";
    }
}
