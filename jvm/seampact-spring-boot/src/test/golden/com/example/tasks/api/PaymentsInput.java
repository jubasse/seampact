package com.example.tasks.api;

import com.example.tasks.api.schemas.PaymentEvent;
import com.example.tasks.api.schemas.WebhookCaller;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record PaymentsInput(@Valid @NotNull PaymentsHeaders headers,
        @Valid @NotNull PaymentEvent body,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) @JsonIgnore WebhookCaller principal) {
    @Override
    public String toString() {
        return "PaymentsInput[headers=" + this.headers() + ", body=" + TasksRedaction.REDACTED + "]";
    }
}
