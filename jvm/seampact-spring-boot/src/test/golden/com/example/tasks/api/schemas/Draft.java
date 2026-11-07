package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record Draft(@NotNull UUID draftId, @NotNull String body) {
    @Override
    public String toString() {
        return "Draft[draftId=" + this.draftId() + ", body=" + this.body() + "]";
    }
}
