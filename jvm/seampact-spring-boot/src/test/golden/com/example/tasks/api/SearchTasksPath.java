package com.example.tasks.api;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record SearchTasksPath(@NotNull UUID channelId) {
    @Override
    public String toString() {
        return "SearchTasksPath[channelId=" + channelId() + "]";
    }
}
