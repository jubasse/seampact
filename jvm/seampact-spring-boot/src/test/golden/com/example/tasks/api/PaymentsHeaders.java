package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record PaymentsHeaders(@JsonProperty("Stripe-Signature") @NotNull String stripeSignature) {
    @Override
    public String toString() {
        return "PaymentsHeaders[stripeSignature=" + TasksRedaction.REDACTED + "]";
    }
}
