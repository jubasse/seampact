package com.example.optins.api;

import com.example.optins.api.schemas.ApiForbiddenParams;
import com.example.optins.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface BrowseTaskErrors extends BrowseTaskResult permits BrowseTaskErrors.ApiSchemaInvalid, BrowseTaskErrors.ApiUnauthenticated, BrowseTaskErrors.ApiForbidden, BrowseTaskErrors.ApiNotFound, BrowseTaskErrors.ApiInternal, BrowseTaskErrors.ApiDeadlineExceeded {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements BrowseTaskErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnauthenticated() implements BrowseTaskErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiForbidden(@Valid @NotNull ApiForbiddenParams params) implements BrowseTaskErrors {
        @Override
        public String toString() {
            return "ApiForbidden[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiNotFound() implements BrowseTaskErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements BrowseTaskErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiDeadlineExceeded() implements BrowseTaskErrors {
        @Override
        public String toString() {
            return "ApiDeadlineExceeded[]";
        }
    }
}
