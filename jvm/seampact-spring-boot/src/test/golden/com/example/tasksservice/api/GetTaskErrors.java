package com.example.tasksservice.api;

import com.example.tasksservice.api.schemas.ApiForbiddenParams;
import com.example.tasksservice.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetTaskErrors extends GetTaskResult permits GetTaskErrors.ApiSchemaInvalid, GetTaskErrors.ApiUnauthenticated, GetTaskErrors.ApiForbidden, GetTaskErrors.ApiNotFound, GetTaskErrors.ApiInternal, GetTaskErrors.ApiDeadlineExceeded {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnauthenticated() implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiForbidden(@Valid @NotNull ApiForbiddenParams params) implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiForbidden[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiNotFound() implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiDeadlineExceeded() implements GetTaskErrors {
        @Override
        public String toString() {
            return "ApiDeadlineExceeded[]";
        }
    }
}
