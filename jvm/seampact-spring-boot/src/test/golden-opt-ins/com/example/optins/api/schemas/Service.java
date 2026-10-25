package com.example.optins.api.schemas;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum Service {
    @JsonProperty("catalog")
    CATALOG,

    @JsonProperty("ticketing")
    TICKETING
}
