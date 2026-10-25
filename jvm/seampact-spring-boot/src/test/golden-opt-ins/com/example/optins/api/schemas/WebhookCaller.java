package com.example.optins.api.schemas;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record WebhookCaller(@NotNull String account) {
    @Override
    public String toString() {
        return "WebhookCaller[account=" + this.account() + "]";
    }
}
