package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Optional;

public record SearchTasksHeaders(@JsonProperty("Authorization") Optional<String> authorization,
        @JsonProperty("X-Csrf-Token") Optional<String> xCsrfToken) {
    @Override
    public String toString() {
        return "SearchTasksHeaders[authorization=" + TasksRedaction.REDACTED + ", xCsrfToken=" + TasksRedaction.REDACTED + "]";
    }
}
