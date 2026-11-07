package com.example.tasks.api;

import com.example.tasks.api.schemas.UpdateTask;
import com.example.tasks.api.schemas.UserPrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record UpdateTaskInput(@Valid @NotNull UpdateTaskPath path,
        @Valid @NotNull UpdateTaskHeaders headers, @Valid @NotNull UpdateTask body,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) @JsonIgnore UserPrincipal principal,
        @JacksonInject(value = "scopes", useInput = OptBoolean.FALSE) @JsonIgnore UpdateTaskScopes scopes) {
    @Override
    public String toString() {
        return "UpdateTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + "]";
    }
}
