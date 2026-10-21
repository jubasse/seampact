package com.example.tasks.api;

import com.example.tasks.api.schemas.Draft;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetDraftResult permits GetDraftResult.Status200, GetDraftErrors {
    record Status200(@Valid @NotNull Draft body) implements GetDraftResult {
        @Override
        public String toString() {
            return "Status200[body=" + body() + "]";
        }
    }
}
