package com.example.tasks.api;

import com.example.tasks.api.schemas.Channel;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetChannelResult permits GetChannelResult.Status200, GetChannelErrors {
    record Status200(@Valid @NotNull Channel body) implements GetChannelResult {
        @Override
        public String toString() {
            return "Status200[body=" + body() + "]";
        }
    }
}
