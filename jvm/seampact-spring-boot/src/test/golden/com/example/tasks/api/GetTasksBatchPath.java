package com.example.tasks.api;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record GetTasksBatchPath(@NotNull UUID channelId) {
    @Override
    public String toString() {
        return "GetTasksBatchPath[channelId=" + channelId() + "]";
    }
}
