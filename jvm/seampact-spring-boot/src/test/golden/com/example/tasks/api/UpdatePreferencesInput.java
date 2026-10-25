package com.example.tasks.api;

import com.example.tasks.api.schemas.UpdatePreferences;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record UpdatePreferencesInput(@Valid @NotNull UpdatePreferencesHeaders headers,
        @Valid @NotNull UpdatePreferences body) {
    @Override
    public String toString() {
        return "UpdatePreferencesInput[headers=" + this.headers() + ", body=" + this.body() + "]";
    }
}
