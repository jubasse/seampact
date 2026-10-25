package com.example.optins.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record BrowseTaskPath(@NotNull UUID area, @NotNull UUID channelId, @NotNull UUID taskId) {
    @Override
    public String toString() {
        return "BrowseTaskPath[area=" + this.area() + ", channelId=" + this.channelId() + ", taskId=" + this.taskId() + "]";
    }
}
