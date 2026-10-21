package com.example.tasks.api;

import com.example.tasks.api.schemas.Task;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Map;

public sealed interface GetTasksBatchResult permits GetTasksBatchResult.Status200, GetTasksBatchErrors {
    record Status200(Map<String, @Valid @NotNull Task> body) implements GetTasksBatchResult {
        @Override
        public String toString() {
            return "Status200[body=" + body() + "]";
        }
    }
}
