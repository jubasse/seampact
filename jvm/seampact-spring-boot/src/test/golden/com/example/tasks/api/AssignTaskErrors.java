package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiForbiddenParams;
import com.example.tasks.api.schemas.ApiPayloadTooLargeParams;
import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface AssignTaskErrors extends AssignTaskResult permits AssignTaskErrors.ApiSchemaInvalid, AssignTaskErrors.ApiUnauthenticated, AssignTaskErrors.ApiCsrfInvalid, AssignTaskErrors.ApiForbidden, AssignTaskErrors.ApiNotFound, AssignTaskErrors.ApiIdempotencyInProgress, AssignTaskErrors.ApiPayloadTooLarge, AssignTaskErrors.ApiUnsupportedMediaType, AssignTaskErrors.ApiIdempotencyKeyReused, AssignTaskErrors.ApiInternal {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements AssignTaskErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnauthenticated() implements AssignTaskErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiCsrfInvalid() implements AssignTaskErrors {
        @Override
        public String toString() {
            return "ApiCsrfInvalid[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiForbidden(@Valid @NotNull ApiForbiddenParams params) implements AssignTaskErrors {
        @Override
        public String toString() {
            return "ApiForbidden[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiNotFound() implements AssignTaskErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyInProgress() implements AssignTaskErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyInProgress[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiPayloadTooLarge(
            @Valid @NotNull ApiPayloadTooLargeParams params) implements AssignTaskErrors {
        @Override
        public String toString() {
            return "ApiPayloadTooLarge[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnsupportedMediaType() implements AssignTaskErrors {
        @Override
        public String toString() {
            return "ApiUnsupportedMediaType[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyKeyReused() implements AssignTaskErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyKeyReused[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements AssignTaskErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
