package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record CreateTask(@NotNull String title, Optional<@Min(0) Long> effort) {
    @Override
    public String toString() {
        return "CreateTask[title=" + this.title() + ", effort=" + this.effort() + "]";
    }
}
