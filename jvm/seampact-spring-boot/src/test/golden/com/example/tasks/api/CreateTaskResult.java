package com.example.tasks.api;

import com.example.tasks.api.schemas.Task;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface CreateTaskResult permits CreateTaskResult.Status201, CreateTaskErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status201(@Valid @NotNull Task body) implements CreateTaskResult {
        @Override
        public String toString() {
            return "Status201[body=" + this.body() + "]";
        }
    }
}
