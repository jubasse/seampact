package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record HealthInput() {
    @Override
    public String toString() {
        return "HealthInput[]";
    }
}
