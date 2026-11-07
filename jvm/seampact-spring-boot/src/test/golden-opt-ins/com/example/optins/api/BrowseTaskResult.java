package com.example.optins.api;

import com.example.optins.api.schemas.Task;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface BrowseTaskResult permits BrowseTaskResult.Status200, BrowseTaskErrors {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record Status200(@Valid @NotNull Task body) implements BrowseTaskResult {
        @Override
        public String toString() {
            return "Status200[body=" + this.body() + "]";
        }
    }
}
