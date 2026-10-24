package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface HealthErrors extends HealthResult permits HealthErrors.ApiSchemaInvalid, HealthErrors.ApiInternal {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(@Valid @NotNull ApiSchemaInvalidParams params) implements HealthErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements HealthErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
