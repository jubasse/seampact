package com.example.tasks.api;

import java.util.Optional;

public record UserCredentials(Optional<String> bearer, Optional<String> sessionCookie) {
    @Override
    public String toString() {
        return "UserCredentials[bearer=" + TasksRedaction.REDACTED + ", sessionCookie=" + TasksRedaction.REDACTED + "]";
    }
}
