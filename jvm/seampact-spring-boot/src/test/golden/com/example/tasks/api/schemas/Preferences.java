package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record Preferences(@NotNull String locale, Optional<Boolean> digest) {
    @Override
    public String toString() {
        return "Preferences[locale=" + this.locale() + ", digest=" + this.digest() + "]";
    }
}
