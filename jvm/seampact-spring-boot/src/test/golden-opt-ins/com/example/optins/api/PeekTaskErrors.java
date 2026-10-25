package com.example.optins.api;

import com.example.optins.api.schemas.ApiForbiddenParams;
import com.example.optins.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface PeekTaskErrors extends PeekTaskResult permits PeekTaskErrors.ApiSchemaInvalid, PeekTaskErrors.ApiUnauthenticated, PeekTaskErrors.ApiForbidden, PeekTaskErrors.ApiNotFound, PeekTaskErrors.ApiInternal, PeekTaskErrors.ApiDeadlineExceeded {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements PeekTaskErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnauthenticated() implements PeekTaskErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiForbidden(@Valid @NotNull ApiForbiddenParams params) implements PeekTaskErrors {
        @Override
        public String toString() {
            return "ApiForbidden[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiNotFound() implements PeekTaskErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements PeekTaskErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiDeadlineExceeded() implements PeekTaskErrors {
        @Override
        public String toString() {
            return "ApiDeadlineExceeded[]";
        }
    }
}
