package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;

public sealed interface ListChannelsResult permits ListChannelsResult.Status200, ListChannelsErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status200(ListChannelsPage body) implements ListChannelsResult {
        @Override
        public String toString() {
            return "Status200[body=" + this.body() + "]";
        }
    }
}
