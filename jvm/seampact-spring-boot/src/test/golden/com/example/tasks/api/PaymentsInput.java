package com.example.tasks.api;

import com.example.tasks.api.schemas.PaymentEvent;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record PaymentsInput(@Valid @NotNull PaymentsHeaders headers,
        @Valid @NotNull PaymentEvent body) {
    @Override
    public String toString() {
        return "PaymentsInput[headers=" + this.headers() + ", body=" + TasksRedaction.REDACTED + "]";
    }
}
