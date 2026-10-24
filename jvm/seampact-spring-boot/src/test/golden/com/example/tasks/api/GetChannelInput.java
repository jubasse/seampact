package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetChannelInput(@Valid @NotNull GetChannelPath path,
        @Valid @NotNull GetChannelHeaders headers) {
    @Override
    public String toString() {
        return "GetChannelInput[path=" + this.path() + ", headers=" + this.headers() + "]";
    }
}
