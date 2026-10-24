package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ApiForbiddenParams(Optional<String> pointer) {
    @Override
    public String toString() {
        return "ApiForbiddenParams[pointer=" + this.pointer() + "]";
    }
}
