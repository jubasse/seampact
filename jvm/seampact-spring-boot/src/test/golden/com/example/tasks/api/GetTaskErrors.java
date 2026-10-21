package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetTaskErrors extends GetTaskResult permits GetTaskErrors.ApiSchemaInvalid, GetTaskErrors.ApiUnauthenticated, GetTaskErrors.ApiNotFound, GetTaskErrors.ApiInternal {
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + params() + "]";
        }
    }

    record ApiUnauthenticated() implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    record ApiNotFound() implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    record ApiInternal() implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
