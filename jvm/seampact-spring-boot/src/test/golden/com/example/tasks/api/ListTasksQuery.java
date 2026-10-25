package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ListTasksQuery(Optional<String> cursor, Optional<@Min(1) @Max(50) Long> limit,
        Optional<List<@NotNull String>> sort) {
    @Override
    public String toString() {
        return "ListTasksQuery[cursor=" + this.cursor() + ", limit=" + this.limit() + ", sort=" + this.sort() + "]";
    }
}
