package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum ReauthIntent {
    @JsonProperty("purge_task")
    PURGE_TASK
}
