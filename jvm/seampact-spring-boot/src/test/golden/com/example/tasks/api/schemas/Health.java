package com.example.tasks.api.schemas;

import jakarta.validation.constraints.NotNull;

public record Health(@NotNull String status) {
    @Override
    public String toString() {
        return "Health[status=" + status() + "]";
    }
}
