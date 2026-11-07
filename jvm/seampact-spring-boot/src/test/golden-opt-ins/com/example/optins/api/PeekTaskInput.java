package com.example.optins.api;

import com.example.optins.api.schemas.ServicePrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record PeekTaskInput(@Valid @NotNull PeekTaskPath path,
        @Valid @NotNull PeekTaskHeaders headers,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) @JsonIgnore ServicePrincipal principal) {
    @Override
    public String toString() {
        return "PeekTaskInput[path=" + this.path() + ", headers=" + this.headers() + "]";
    }
}
