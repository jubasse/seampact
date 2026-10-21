package com.example.tasks.api.schemas;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record UserPrincipal(@NotNull UUID userId) {
    @Override
    public String toString() {
        return "UserPrincipal[userId=" + userId() + "]";
    }
}
