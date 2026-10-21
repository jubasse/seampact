package com.example.tasks.api.schemas;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

public record Task(@NotNull UUID taskId, @NotNull String title, @NotNull TaskState state,
        Optional<@Min(0) Long> effort, @Min(1) long version, @NotNull OffsetDateTime createdAt) {
    @Override
    public String toString() {
        return "Task[taskId=" + taskId() + ", title=" + title() + ", state=" + state() + ", effort=" + effort() + ", version=" + version() + ", createdAt=" + createdAt() + "]";
    }
}
