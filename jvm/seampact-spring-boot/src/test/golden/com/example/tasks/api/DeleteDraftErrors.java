package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface DeleteDraftErrors extends DeleteDraftResult permits DeleteDraftErrors.ApiSchemaInvalid, DeleteDraftErrors.ApiUnauthenticated, DeleteDraftErrors.ApiCsrfInvalid, DeleteDraftErrors.ApiNotFound, DeleteDraftErrors.ApiIdempotencyInProgress, DeleteDraftErrors.ApiIdempotencyKeyReused, DeleteDraftErrors.ApiInternal {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements DeleteDraftErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnauthenticated() implements DeleteDraftErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiCsrfInvalid() implements DeleteDraftErrors {
        @Override
        public String toString() {
            return "ApiCsrfInvalid[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiNotFound() implements DeleteDraftErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyInProgress() implements DeleteDraftErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyInProgress[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiIdempotencyKeyReused() implements DeleteDraftErrors {
        @Override
        public String toString() {
            return "ApiIdempotencyKeyReused[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements DeleteDraftErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
