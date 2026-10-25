package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record UpdateTaskPath(@NotNull UUID channelId, @NotNull UUID taskId) {
    @Override
    public String toString() {
        return "UpdateTaskPath[channelId=" + this.channelId() + ", taskId=" + this.taskId() + "]";
    }
}
