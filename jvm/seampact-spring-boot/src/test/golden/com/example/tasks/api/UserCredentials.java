package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record UserCredentials(Optional<String> bearer, Optional<String> sessionCookie) {
    @Override
    public String toString() {
        return "UserCredentials[bearer=" + TasksRedaction.REDACTED + ", sessionCookie=" + TasksRedaction.REDACTED + "]";
    }
}
