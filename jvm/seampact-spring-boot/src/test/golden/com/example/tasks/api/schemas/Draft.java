package com.example.tasks.api.schemas;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record Draft(@NotNull UUID draftId, @NotNull String body) {
    @Override
    public String toString() {
        return "Draft[draftId=" + draftId() + ", body=" + body() + "]";
    }
}
