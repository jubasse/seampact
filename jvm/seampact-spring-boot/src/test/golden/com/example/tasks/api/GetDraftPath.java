package com.example.tasks.api;

import jakarta.validation.constraints.NotNull;
import java.util.UUID;

public record GetDraftPath(@NotNull UUID draftId) {
    @Override
    public String toString() {
        return "GetDraftPath[draftId=" + draftId() + "]";
    }
}
