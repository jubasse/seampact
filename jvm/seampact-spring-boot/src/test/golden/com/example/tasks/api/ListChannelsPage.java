package com.example.tasks.api;

import com.example.tasks.api.schemas.Channel;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Optional;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ListChannelsPage(List<@Valid @NotNull Channel> items, Optional<String> nextCursor) {
    @Override
    public String toString() {
        return "ListChannelsPage[items=" + this.items() + ", nextCursor=" + this.nextCursor() + "]";
    }
}
