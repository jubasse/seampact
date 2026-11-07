package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetPreferencesErrors extends GetPreferencesResult permits GetPreferencesErrors.ApiSchemaInvalid, GetPreferencesErrors.ApiUnauthenticated, GetPreferencesErrors.ApiNotFound, GetPreferencesErrors.ApiInternal {
    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements GetPreferencesErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + this.params() + "]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiUnauthenticated() implements GetPreferencesErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiNotFound() implements GetPreferencesErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    @JsonInclude(JsonInclude.Include.NON_ABSENT)
    record ApiInternal() implements GetPreferencesErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
