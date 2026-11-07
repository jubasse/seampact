package com.example.tasks.api;

import com.example.tasks.api.schemas.UserPrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ListChannelsInput(@Valid @NotNull ListChannelsQuery query,
        @Valid @NotNull ListChannelsHeaders headers,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) @JsonIgnore UserPrincipal principal) {
    @Override
    public String toString() {
        return "ListChannelsInput[query=" + this.query() + ", headers=" + this.headers() + "]";
    }
}
