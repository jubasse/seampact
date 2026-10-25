package com.example.tasks.api;

import com.example.tasks.api.schemas.Draft;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface DeleteDraftResult permits DeleteDraftResult.Status200, DeleteDraftErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status200(@Valid @NotNull Draft body) implements DeleteDraftResult {
        @Override
        public String toString() {
            return "Status200[body=" + this.body() + "]";
        }
    }
}
