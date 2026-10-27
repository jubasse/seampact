package com.example.optins.api;

import com.example.optins.api.schemas.ServicePrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetTaskInput(@Valid @NotNull GetTaskPath path, @Valid @NotNull GetTaskHeaders headers,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) ServicePrincipal principal) {
    @Override
    public String toString() {
        return "GetTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", principal=" + this.principal() + "]";
    }
}
