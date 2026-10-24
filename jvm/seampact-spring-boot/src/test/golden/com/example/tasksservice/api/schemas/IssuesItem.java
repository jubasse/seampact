package com.example.tasksservice.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record IssuesItem(@NotNull String pointer, @NotNull String rule) {
    @Override
    public String toString() {
        return "IssuesItem[pointer=" + this.pointer() + ", rule=" + this.rule() + "]";
    }
}
