package com.example.tasks.api;

import com.example.tasks.api.schemas.Channel;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetChannelResult permits GetChannelResult.Status200, GetChannelErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status200(@Valid @NotNull Channel body) implements GetChannelResult {
        @Override
        public String toString() {
            return "Status200[body=" + this.body() + "]";
        }
    }
}
