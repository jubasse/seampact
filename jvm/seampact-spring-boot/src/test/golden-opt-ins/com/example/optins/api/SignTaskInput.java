package com.example.optins.api;

import com.example.optins.api.schemas.WebhookCaller;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record SignTaskInput(@Valid @NotNull SignTaskPath path,
        @Valid @NotNull SignTaskHeaders headers,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) WebhookCaller principal) {
    @Override
    public String toString() {
        return "SignTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", principal=" + this.principal() + "]";
    }
}
