package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiForbiddenParams;
import com.example.tasks.api.schemas.ApiPayloadTooLargeParams;
import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface UpdateTaskErrors extends UpdateTaskResult permits UpdateTaskErrors.ApiSchemaInvalid, UpdateTaskErrors.ApiUnauthenticated, UpdateTaskErrors.ApiCsrfInvalid, UpdateTaskErrors.ApiForbidden, UpdateTaskErrors.ApiNotFound, UpdateTaskErrors.ApiIdempotencyInProgress, UpdateTaskErrors.StateConflict, UpdateTaskErrors.ApiPayloadTooLarge, UpdateTaskErrors.ApiUnsupportedMediaType, UpdateTaskErrors.ApiIdempotencyKeyReused, UpdateTaskErrors.ApiInternal {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnauthenticated() implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiCsrfInvalid() implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "ApiCsrfInvalid[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiForbidden(@Valid @NotNull ApiForbiddenParams params) implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "ApiForbidden[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiNotFound() implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyInProgress() implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyInProgress[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record StateConflict() implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "StateConflict[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiPayloadTooLarge(
            @Valid @NotNull ApiPayloadTooLargeParams params) implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "ApiPayloadTooLarge[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnsupportedMediaType() implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "ApiUnsupportedMediaType[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyKeyReused() implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyKeyReused[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements UpdateTaskErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
