package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record TaskSearchResult(@NotNull List<@Valid @NotNull Task> items,
        Optional<@Min(0) Long> total) {
    @Override
    public String toString() {
        return "TaskSearchResult[items=" + this.items() + ", total=" + this.total() + "]";
    }
}
