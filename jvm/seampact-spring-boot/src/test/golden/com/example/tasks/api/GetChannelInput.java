package com.example.tasks.api;

import com.example.tasks.api.schemas.UserPrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record GetChannelInput(@Valid @NotNull GetChannelPath path,
        @Valid @NotNull GetChannelHeaders headers,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) UserPrincipal principal,
        GetChannelScopes scopes) {
    @Override
    public String toString() {
        return "GetChannelInput[path=" + this.path() + ", headers=" + this.headers() + ", principal=" + this.principal() + ", scopes=" + this.scopes() + "]";
    }
}
