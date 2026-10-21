package com.example.tasksservice.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import java.util.Optional;

public record GetTaskHeaders(@JsonProperty("Authorization") @NotNull String authorization,
        @JsonProperty("X-Deadline") @NotNull String xDeadline, Optional<String> traceparent) {
    @Override
    public String toString() {
        return "GetTaskHeaders[authorization=" + TasksServiceRedaction.REDACTED + ", xDeadline=" + TasksServiceRedaction.REDACTED + ", traceparent=" + TasksServiceRedaction.REDACTED + "]";
    }
}
