package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiForbiddenParams;
import com.example.tasks.api.schemas.ApiPayloadTooLargeParams;
import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface SearchTasksErrors extends SearchTasksResult permits SearchTasksErrors.ApiSchemaInvalid, SearchTasksErrors.ApiUnauthenticated, SearchTasksErrors.ApiCsrfInvalid, SearchTasksErrors.ApiForbidden, SearchTasksErrors.ApiNotFound, SearchTasksErrors.ApiPayloadTooLarge, SearchTasksErrors.ApiUnsupportedMediaType, SearchTasksErrors.ApiInternal {
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements SearchTasksErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + params() + "]";
        }
    }

    record ApiUnauthenticated() implements SearchTasksErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    record ApiCsrfInvalid() implements SearchTasksErrors {
        @Override
        public String toString() {
            return "ApiCsrfInvalid[]";
        }
    }

    record ApiForbidden(@Valid @NotNull ApiForbiddenParams params) implements SearchTasksErrors {
        @Override
        public String toString() {
            return "ApiForbidden[params=" + params() + "]";
        }
    }

    record ApiNotFound() implements SearchTasksErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    record ApiPayloadTooLarge(
            @Valid @NotNull ApiPayloadTooLargeParams params) implements SearchTasksErrors {
        @Override
        public String toString() {
            return "ApiPayloadTooLarge[params=" + params() + "]";
        }
    }

    record ApiUnsupportedMediaType() implements SearchTasksErrors {
        @Override
        public String toString() {
            return "ApiUnsupportedMediaType[]";
        }
    }

    record ApiInternal() implements SearchTasksErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
