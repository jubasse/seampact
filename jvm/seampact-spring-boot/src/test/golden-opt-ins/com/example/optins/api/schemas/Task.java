package com.example.optins.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record Task(@NotNull UUID taskId, @NotNull String title, @NotNull TaskState state,
        Optional<@Min(0) Long> effort, @Min(1) long version, @NotNull OffsetDateTime createdAt) {
    @Override
    public String toString() {
        return "Task[taskId=" + this.taskId() + ", title=" + this.title() + ", state=" + this.state() + ", effort=" + this.effort() + ", version=" + this.version() + ", createdAt=" + this.createdAt() + "]";
    }
}
