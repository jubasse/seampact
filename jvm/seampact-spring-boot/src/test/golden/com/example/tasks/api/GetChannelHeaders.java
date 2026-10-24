package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetChannelHeaders(@JsonProperty("Authorization") Optional<String> authorization) {
    @Override
    public String toString() {
        return "GetChannelHeaders[authorization=" + TasksRedaction.REDACTED + "]";
    }
}
