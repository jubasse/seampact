package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface HealthErrors extends HealthResult permits HealthErrors.ApiSchemaInvalid, HealthErrors.ApiInternal {
    record ApiSchemaInvalid(@Valid @NotNull ApiSchemaInvalidParams params) implements HealthErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + params() + "]";
        }
    }

    record ApiInternal() implements HealthErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
