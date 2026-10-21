package com.example.tasksservice.api;

import com.example.tasksservice.api.schemas.ApiForbiddenParams;
import com.example.tasksservice.api.schemas.ApiSchemaInvalidParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetTaskErrors extends GetTaskResult permits GetTaskErrors.ApiSchemaInvalid, GetTaskErrors.ApiUnauthenticated, GetTaskErrors.ApiForbidden, GetTaskErrors.ApiNotFound, GetTaskErrors.ApiInternal, GetTaskErrors.ApiDeadlineExceeded {
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

    record ApiForbidden(@Valid @NotNull ApiForbiddenParams params) implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiForbidden[params=" + params() + "]";
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

    record ApiDeadlineExceeded() implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiDeadlineExceeded[]";
        }
    }
}
