package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiPayloadTooLargeParams;
import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface PurgeTaskErrors extends PurgeTaskResult permits PurgeTaskErrors.ApiSchemaInvalid, PurgeTaskErrors.ApiReauthenticationRequired, PurgeTaskErrors.ApiUnauthenticated, PurgeTaskErrors.ApiCsrfInvalid, PurgeTaskErrors.ApiNotFound, PurgeTaskErrors.ApiIdempotencyInProgress, PurgeTaskErrors.ApiPayloadTooLarge, PurgeTaskErrors.ApiUnsupportedMediaType, PurgeTaskErrors.ApiIdempotencyKeyReused, PurgeTaskErrors.ApiInternal {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements PurgeTaskErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiReauthenticationRequired() implements PurgeTaskErrors {
        @Override
        public String toString() {
            return "ApiReauthenticationRequired[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnauthenticated() implements PurgeTaskErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiCsrfInvalid() implements PurgeTaskErrors {
        @Override
        public String toString() {
            return "ApiCsrfInvalid[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiNotFound() implements PurgeTaskErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyInProgress() implements PurgeTaskErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyInProgress[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiPayloadTooLarge(
            @Valid @NotNull ApiPayloadTooLargeParams params) implements PurgeTaskErrors {
        @Override
        public String toString() {
            return "ApiPayloadTooLarge[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnsupportedMediaType() implements PurgeTaskErrors {
        @Override
        public String toString() {
            return "ApiUnsupportedMediaType[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyKeyReused() implements PurgeTaskErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyKeyReused[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements PurgeTaskErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
