package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record AssignTaskInput(@NotNull UUID userId) {
    @Override
    public String toString() {
        return "AssignTaskInput[userId=" + this.userId() + "]";
    }
}
