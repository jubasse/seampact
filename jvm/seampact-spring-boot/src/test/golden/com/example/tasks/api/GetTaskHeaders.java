package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Optional;

public record GetTaskHeaders(@JsonProperty("Authorization") Optional<String> authorization) {
    @Override
    public String toString() {
        return "GetTaskHeaders[authorization=" + TasksRedaction.REDACTED + "]";
    }
}
