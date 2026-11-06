package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum Role {
    @JsonProperty("owner")
    OWNER,

    @JsonProperty("editor")
    EDITOR,

    @JsonProperty("viewer")
    VIEWER
}
