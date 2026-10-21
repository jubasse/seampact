package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiPayloadTooLargeParams;
import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetTasksBatchErrors extends GetTasksBatchResult permits GetTasksBatchErrors.ApiSchemaInvalid, GetTasksBatchErrors.ApiUnauthenticated, GetTasksBatchErrors.ApiNotFound, GetTasksBatchErrors.ApiPayloadTooLarge, GetTasksBatchErrors.ApiUnsupportedMediaType, GetTasksBatchErrors.ApiInternal {
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements GetTasksBatchErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + params() + "]";
        }
    }

    record ApiUnauthenticated() implements GetTasksBatchErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    record ApiNotFound() implements GetTasksBatchErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    record ApiPayloadTooLarge(
            @Valid @NotNull ApiPayloadTooLargeParams params) implements GetTasksBatchErrors {
        @Override
        public String toString() {
            return "ApiPayloadTooLarge[params=" + params() + "]";
        }
    }

    record ApiUnsupportedMediaType() implements GetTasksBatchErrors {
        @Override
        public String toString() {
            return "ApiUnsupportedMediaType[]";
        }
    }

    record ApiInternal() implements GetTasksBatchErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
