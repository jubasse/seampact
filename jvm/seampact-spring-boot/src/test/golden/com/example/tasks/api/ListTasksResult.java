package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;

public sealed interface ListTasksResult permits ListTasksResult.Status200, ListTasksErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status200(ListTasksPage body) implements ListTasksResult {
        @Override
        public String toString() {
            return "Status200[body=" + this.body() + "]";
        }
    }
}
