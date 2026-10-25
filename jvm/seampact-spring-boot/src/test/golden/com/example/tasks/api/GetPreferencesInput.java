package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetPreferencesInput(@Valid @NotNull GetPreferencesHeaders headers) {
    @Override
    public String toString() {
        return "GetPreferencesInput[headers=" + this.headers() + "]";
    }
}
