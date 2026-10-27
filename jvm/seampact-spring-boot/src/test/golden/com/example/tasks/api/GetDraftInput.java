package com.example.tasks.api;

import com.example.tasks.api.schemas.UserPrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetDraftInput(@Valid @NotNull GetDraftPath path,
        @Valid @NotNull GetDraftHeaders headers,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) UserPrincipal principal) {
    @Override
    public String toString() {
        return "GetDraftInput[path=" + this.path() + ", headers=" + this.headers() + ", principal=" + this.principal() + "]";
    }
}
