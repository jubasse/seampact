package com.example.tasksservice.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ApiSchemaInvalidParams(@NotNull List<@Valid @NotNull IssuesItem> issues) {
    @Override
    public String toString() {
        return "ApiSchemaInvalidParams[issues=" + this.issues() + "]";
    }
}
