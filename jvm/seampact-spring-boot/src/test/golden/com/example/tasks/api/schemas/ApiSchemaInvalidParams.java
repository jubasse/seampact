package com.example.tasks.api.schemas;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record ApiSchemaInvalidParams(@NotNull List<@Valid @NotNull IssuesItem> issues) {
    @Override
    public String toString() {
        return "ApiSchemaInvalidParams[issues=" + issues() + "]";
    }
}
