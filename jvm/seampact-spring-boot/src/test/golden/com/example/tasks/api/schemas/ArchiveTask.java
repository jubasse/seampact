package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ArchiveTask(@NotNull String reason, @Min(1) long expectedVersion) {
    @Override
    public String toString() {
        return "ArchiveTask[reason=" + this.reason() + ", expectedVersion=" + this.expectedVersion() + "]";
    }
}
