package com.example.tasks.api;

import com.example.tasks.api.schemas.Task;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Map;

public sealed interface GetTasksBatchResult permits GetTasksBatchResult.Status200, GetTasksBatchErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status200(Map<String, @Valid @NotNull Task> body) implements GetTasksBatchResult {
        @Override
        public String toString() {
            return "Status200[body=" + this.body() + "]";
        }
    }
}
