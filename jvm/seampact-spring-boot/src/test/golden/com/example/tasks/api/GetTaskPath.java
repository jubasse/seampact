package com.example.tasks.api;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record GetTaskPath(@NotNull UUID channelId, @NotNull UUID taskId) {
    @Override
    public String toString() {
        return "GetTaskPath[channelId=" + channelId() + ", taskId=" + taskId() + "]";
    }
}
