package com.example.optins.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record BrowseTaskInput(@Valid @NotNull BrowseTaskPath path,
        @Valid @NotNull BrowseTaskHeaders headers) {
    @Override
    public String toString() {
        return "BrowseTaskInput[path=" + this.path() + ", headers=" + this.headers() + "]";
    }
}
