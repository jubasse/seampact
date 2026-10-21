package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetDraftErrors extends GetDraftResult permits GetDraftErrors.ApiSchemaInvalid, GetDraftErrors.ApiUnauthenticated, GetDraftErrors.ApiNotFound, GetDraftErrors.ApiInternal {
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements GetDraftErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + params() + "]";
        }
    }

    record ApiUnauthenticated() implements GetDraftErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    record ApiNotFound() implements GetDraftErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    record ApiInternal() implements GetDraftErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
