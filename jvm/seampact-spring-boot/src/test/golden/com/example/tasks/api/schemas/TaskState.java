package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum TaskState {
    @JsonProperty("open")
    OPEN,

    @JsonProperty("done")
    DONE,

    @JsonProperty("archived")
    ARCHIVED
}
