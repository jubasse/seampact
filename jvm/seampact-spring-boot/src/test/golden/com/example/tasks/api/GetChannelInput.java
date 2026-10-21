package com.example.tasks.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public record GetChannelInput(@Valid @NotNull GetChannelPath path,
        @Valid @NotNull GetChannelHeaders headers) {
    @Override
    public String toString() {
        return "GetChannelInput[path=" + path() + ", headers=" + headers() + "]";
    }
}
