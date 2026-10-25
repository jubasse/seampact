package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ListChannelsInput(@Valid @NotNull ListChannelsQuery query,
        @Valid @NotNull ListChannelsHeaders headers) {
    @Override
    public String toString() {
        return "ListChannelsInput[query=" + this.query() + ", headers=" + this.headers() + "]";
    }
}
