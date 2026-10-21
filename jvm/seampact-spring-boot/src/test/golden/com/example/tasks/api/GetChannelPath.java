package com.example.tasks.api;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record GetChannelPath(@NotNull UUID channelId) {
    @Override
    public String toString() {
        return "GetChannelPath[channelId=" + channelId() + "]";
    }
}
