package com.example.tasksservice.api.schemas;

import jakarta.validation.constraints.NotNull;

public record IssuesItem(@NotNull String pointer, @NotNull String rule) {
    @Override
    public String toString() {
        return "IssuesItem[pointer=" + pointer() + ", rule=" + rule() + "]";
    }
}
