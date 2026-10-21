package com.example.tasks.api.schemas;

import java.util.Optional;

public record ApiForbiddenParams(Optional<String> pointer) {
    @Override
    public String toString() {
        return "ApiForbiddenParams[pointer=" + pointer() + "]";
    }
}
