package com.example.tasks.api;

import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import io.github.jubasse.seampact.hooks.ResolvedScope;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ListTasksScopes(
        @JacksonInject(value = "scope.channel", useInput = OptBoolean.FALSE) ResolvedScope<?, ?> channel) {
    @Override
    public String toString() {
        return "ListTasksScopes[channel=" + this.channel() + "]";
    }
}
