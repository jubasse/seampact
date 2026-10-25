package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiEmptyBody;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

@JsonInclude(JsonInclude.Include.NON_ABSENT)
public record PurgeTaskInput(@Valid @NotNull PurgeTaskPath path,
        @Valid @NotNull PurgeTaskHeaders headers, @Valid @NotNull ApiEmptyBody body) {
    @Override
    public String toString() {
        return "PurgeTaskInput[path=" + this.path() + ", headers=" + this.headers() + ", body=" + this.body() + "]";
    }
}
