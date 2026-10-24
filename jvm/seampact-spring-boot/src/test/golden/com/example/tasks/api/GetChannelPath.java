package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetChannelPath(@NotNull UUID channelId) {
    @Override
    public String toString() {
        return "GetChannelPath[channelId=" + this.channelId() + "]";
    }
}
