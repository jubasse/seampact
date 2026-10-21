package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Optional;

public record GetDraftHeaders(@JsonProperty("Authorization") Optional<String> authorization) {
    @Override
    public String toString() {
        return "GetDraftHeaders[authorization=" + TasksRedaction.REDACTED + "]";
    }
}
