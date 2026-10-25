package com.example.tasks.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;
import tools.jackson.databind.JsonNode;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record PaymentEvent(@NotNull String id, @NotNull String type, @NotNull JsonNode data) {
    @Override
    public String toString() {
        return "PaymentEvent[id=" + this.id() + ", type=" + this.type() + ", data=" + this.data() + "]";
    }
}
