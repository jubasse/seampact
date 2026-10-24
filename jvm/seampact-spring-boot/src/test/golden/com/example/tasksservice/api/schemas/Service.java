package com.example.tasksservice.api.schemas;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum Service {
    @JsonProperty("catalog")
    CATALOG,

    @JsonProperty("ticketing")
    TICKETING
}
