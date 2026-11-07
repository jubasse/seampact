package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiPayloadTooLargeParams;
import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface ArchiveTaskErrors extends ArchiveTaskResult permits ArchiveTaskErrors.ApiSchemaInvalid, ArchiveTaskErrors.ApiUnauthenticated, ArchiveTaskErrors.ApiCsrfInvalid, ArchiveTaskErrors.ApiNotFound, ArchiveTaskErrors.ApiIdempotencyInProgress, ArchiveTaskErrors.StateConflict, ArchiveTaskErrors.ApiPayloadTooLarge, ArchiveTaskErrors.ApiUnsupportedMediaType, ArchiveTaskErrors.ApiIdempotencyKeyReused, ArchiveTaskErrors.ApiInternal {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements ArchiveTaskErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnauthenticated() implements ArchiveTaskErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiCsrfInvalid() implements ArchiveTaskErrors {
        @Override
        public String toString() {
            return "ApiCsrfInvalid[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiNotFound() implements ArchiveTaskErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyInProgress() implements ArchiveTaskErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyInProgress[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record StateConflict() implements ArchiveTaskErrors {
        @Override
        public String toString() {
            return "StateConflict[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiPayloadTooLarge(
            @Valid @NotNull ApiPayloadTooLargeParams params) implements ArchiveTaskErrors {
        @Override
        public String toString() {
            return "ApiPayloadTooLarge[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnsupportedMediaType() implements ArchiveTaskErrors {
        @Override
        public String toString() {
            return "ApiUnsupportedMediaType[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyKeyReused() implements ArchiveTaskErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyKeyReused[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements ArchiveTaskErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
