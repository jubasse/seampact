package com.example.tasks.api.schemas;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record Channel(@NotNull UUID channelId, @NotNull String name) {
    @Override
    public String toString() {
        return "Channel[channelId=" + channelId() + ", name=" + name() + "]";
    }
}
