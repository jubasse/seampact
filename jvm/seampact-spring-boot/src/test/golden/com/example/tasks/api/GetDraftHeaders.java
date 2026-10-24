package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetDraftHeaders(@JsonProperty("Authorization") Optional<String> authorization) {
    @Override
    public String toString() {
        return "GetDraftHeaders[authorization=" + TasksRedaction.REDACTED + "]";
    }
}
