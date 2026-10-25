package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record UpdateTaskHeaders(@JsonProperty("Authorization") Optional<String> authorization,
        @JsonProperty("X-Csrf-Token") Optional<String> xCsrfToken,
        @JsonProperty("Idempotency-Key") @NotNull String idempotencyKey) {
    @Override
    public String toString() {
        return "UpdateTaskHeaders[authorization=" + TasksRedaction.REDACTED + ", xCsrfToken=" + TasksRedaction.REDACTED + ", idempotencyKey=" + this.idempotencyKey() + "]";
    }
}
