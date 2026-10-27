package com.example.tasks.api;

import com.example.tasks.api.schemas.ArchiveTask;
import com.example.tasks.api.schemas.UserPrincipal;
import com.fasterxml.jackson.annotation.JacksonInject;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.OptBoolean;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record ArchiveTaskInput(@Valid @NotNull ArchiveTaskPath path,
        @Valid @NotNull ArchiveTaskHeaders headers, @Valid @NotNull ArchiveTask body,
        @JacksonInject(value = "principal", useInput = OptBoolean.FALSE) UserPrincipal principal,
        ArchiveTaskScopes scopes) {
    @Override
    public String toString() {
        return "ArchiveTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + ", principal=" + this.principal() + ", scopes=" + this.scopes() + "]";
    }
}
