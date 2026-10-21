package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

public sealed interface GetChannelErrors extends GetChannelResult permits GetChannelErrors.ApiSchemaInvalid, GetChannelErrors.ApiUnauthenticated, GetChannelErrors.ApiNotFound, GetChannelErrors.ApiInternal {
    record ApiSchemaInvalid(
            @Valid @NotNull ApiSchemaInvalidParams params) implements GetChannelErrors {
        @Override
        public String toString() {
            return "ApiSchemaInvalid[params=" + params() + "]";
        }
    }

    record ApiUnauthenticated() implements GetChannelErrors {
        @Override
        public String toString() {
            return "ApiUnauthenticated[]";
        }
    }

    record ApiNotFound() implements GetChannelErrors {
        @Override
        public String toString() {
            return "ApiNotFound[]";
        }
    }

    record ApiInternal() implements GetChannelErrors {
        @Override
        public String toString() {
            return "ApiInternal[]";
        }
    }
}
