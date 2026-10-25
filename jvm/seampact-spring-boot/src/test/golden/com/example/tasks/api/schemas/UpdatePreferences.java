package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record UpdatePreferences(Optional<String> locale, Optional<Boolean> digest) {
    @Override
    public String toString() {
        return "UpdatePreferences[locale=" + this.locale() + ", digest=" + this.digest() + "]";
    }
}
