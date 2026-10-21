package com.example.tasks.api;

import com.example.tasks.api.schemas.TaskSearchResult;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface SearchTasksResult permits SearchTasksResult.Status200, SearchTasksErrors {
    record Status200(@Valid @NotNull TaskSearchResult body) implements SearchTasksResult {
        @Override
        public String toString() {
            return "Status200[body=" + body() + "]";
        }
    }
}
