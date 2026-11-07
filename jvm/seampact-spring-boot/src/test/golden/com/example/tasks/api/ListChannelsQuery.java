package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ListChannelsQuery(Optional<String> cursor, Optional<@Min(1) @Max(100) Long> limit) {
    @Override
    public String toString() {
        return "ListChannelsQuery[cursor=" + this.cursor() + ", limit=" + this.limit() + "]";
    }
}
