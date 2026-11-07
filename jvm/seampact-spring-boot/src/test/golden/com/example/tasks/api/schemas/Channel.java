package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record Channel(@NotNull UUID channelId, @NotNull String name) {
    @Override
    public String toString() {
        return "Channel[channelId=" + this.channelId() + ", name=" + this.name() + "]";
    }
}
