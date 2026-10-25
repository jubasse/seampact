package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetPreferencesHeaders(@JsonProperty("Authorization") Optional<String> authorization,
        @JsonProperty("If-None-Match") Optional<String> ifNoneMatch) {
    @Override
    public String toString() {
        return "GetPreferencesHeaders[authorization=" + TasksRedaction.REDACTED + ", ifNoneMatch=" + this.ifNoneMatch() + "]";
    }
}
