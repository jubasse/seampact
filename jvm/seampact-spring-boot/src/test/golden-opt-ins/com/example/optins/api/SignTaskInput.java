package com.example.optins.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record SignTaskInput(@Valid @NotNull SignTaskPath path,
        @Valid @NotNull SignTaskHeaders headers) {
    @Override
    public String toString() {
        return "SignTaskInput[path=" + this.path() + ", headers=" + this.headers() + "]";
    }
}
