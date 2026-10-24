package com.example.tasks.api;

import com.example.tasks.api.schemas.TaskSearchResult;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface SearchTasksResult permits SearchTasksResult.Status200, SearchTasksErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status200(@Valid @NotNull TaskSearchResult body) implements SearchTasksResult {
        @Override
        public String toString() {
            return "Status200[body=" + this.body() + "]";
        }
    }
}
