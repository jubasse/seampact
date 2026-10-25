package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiForbiddenParams;
import com.example.tasks.api.schemas.ApiPayloadTooLargeParams;
import com.example.tasks.api.schemas.ApiRateLimitedParams;
import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface CreateTaskErrors extends CreateTaskResult permits CreateTaskErrors.ApiSchemaInvalid, CreateTaskErrors.ApiUnauthenticated, CreateTaskErrors.ApiCsrfInvalid, CreateTaskErrors.ApiForbidden, CreateTaskErrors.ApiNotFound, CreateTaskErrors.ApiIdempotencyInProgress, CreateTaskErrors.ApiPayloadTooLarge, CreateTaskErrors.ApiUnsupportedMediaType, CreateTaskErrors.ApiIdempotencyKeyReused, CreateTaskErrors.ApiRateLimited, CreateTaskErrors.ApiInternal {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnauthenticated() implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiCsrfInvalid() implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiCsrfInvalid[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiForbidden(@Valid @NotNull ApiForbiddenParams params) implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiForbidden[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiNotFound() implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyInProgress() implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyInProgress[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiPayloadTooLarge(
            @Valid @NotNull ApiPayloadTooLargeParams params) implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiPayloadTooLarge[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnsupportedMediaType() implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiUnsupportedMediaType[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyKeyReused() implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyKeyReused[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiRateLimited(@Valid @NotNull ApiRateLimitedParams params) implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiRateLimited[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements CreateTaskErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
