package com.example.optins.api.schemas;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum TaskState {
    @JsonProperty("open")
    OPEN,

    @JsonProperty("done")
    DONE,

    @JsonProperty("archived")
    ARCHIVED
}
