package com.example.tasks.api;

import com.example.tasks.api.schemas.TaskQuery;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public record SearchTasksInput(@Valid @NotNull SearchTasksPath path,
        @Valid @NotNull SearchTasksHeaders headers, @Valid @NotNull TaskQuery body) {
    @Override
    public String toString() {
        return "SearchTasksInput[path=" + path() + ", headers=" + headers() + ", body=" + body() + "]";
    }
}
