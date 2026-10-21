package com.example.tasksservice.api;

import java.util.Optional;

public record ServiceCredentials(Optional<String> internalToken) {
    @Override
    public String toString() {
        return "ServiceCredentials[internalToken=" + TasksServiceRedaction.REDACTED + "]";
    }
}
