package com.example.optins.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record BrowseTaskHeaders(@JsonProperty("Authorization") @NotNull String authorization,
        @JsonProperty("X-Deadline") @NotNull String xDeadline, Optional<String> traceparent) {
    @Override
    public String toString() {
        return "BrowseTaskHeaders[authorization=" + TasksServiceRedaction.REDACTED + ", xDeadline=" + TasksServiceRedaction.REDACTED + ", traceparent=" + TasksServiceRedaction.REDACTED + "]";
    }
}
