package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;

public sealed interface PurgeTaskResult permits PurgeTaskResult.Status204, PurgeTaskErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status204() implements PurgeTaskResult {
        @Override
        public String toString() {
            return "Status204[]";
        }
    }
}
