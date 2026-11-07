package com.example.tasksservice.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ServiceCredentials(Optional<String> internalToken) {
    @Override
    public String toString() {
        return "ServiceCredentials[internalToken=" + TasksServiceRedaction.REDACTED + "]";
    }
}
