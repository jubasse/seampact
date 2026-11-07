package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record Health(@NotNull String status) {
    @Override
    public String toString() {
        return "Health[status=" + this.status() + "]";
    }
}
