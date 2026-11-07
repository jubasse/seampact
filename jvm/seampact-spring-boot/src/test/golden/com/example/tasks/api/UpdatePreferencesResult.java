package com.example.tasks.api;

import com.example.tasks.api.schemas.Preferences;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface UpdatePreferencesResult permits UpdatePreferencesResult.Status200, UpdatePreferencesErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status200(@Valid @NotNull Preferences body) implements UpdatePreferencesResult {
        @Override
        public String toString() {
            return "Status200[body=" + this.body() + "]";
        }
    }
}
