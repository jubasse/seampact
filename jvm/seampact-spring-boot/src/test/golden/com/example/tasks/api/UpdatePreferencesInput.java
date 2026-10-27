package com.example.tasks.api;

import com.example.tasks.api.schemas.UpdatePreferences;
import com.example.tasks.api.schemas.UserPrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record UpdatePreferencesInput(@Valid @NotNull UpdatePreferencesHeaders headers,
        @Valid @NotNull UpdatePreferences body,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) UserPrincipal principal) {
    @Override
    public String toString() {
        return "UpdatePreferencesInput[headers=" + this.headers() + ", body=" + this.body() + ", principal=" + this.principal() + "]";
    }
}
