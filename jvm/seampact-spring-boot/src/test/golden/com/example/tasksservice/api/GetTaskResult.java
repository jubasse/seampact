package com.example.tasksservice.api;

import com.example.tasksservice.api.schemas.Task;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetTaskResult permits GetTaskResult.Status200, GetTaskErrors {
    record Status200(@Valid @NotNull Task body) implements GetTaskResult {
        @Override
        public String toString() {
            return "Status200[body=" + body() + "]";
        }
    }
}
