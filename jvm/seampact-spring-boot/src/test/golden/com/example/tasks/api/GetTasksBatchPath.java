package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetTasksBatchPath(@NotNull UUID channelId) {
    @Override
    public String toString() {
        return "GetTasksBatchPath[channelId=" + this.channelId() + "]";
    }
}
