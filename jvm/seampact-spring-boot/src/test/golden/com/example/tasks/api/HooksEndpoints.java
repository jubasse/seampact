package com.example.tasks.api;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface HooksEndpoints {
    PaymentsResult payments(PaymentsInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError,
            ApiInternalError;
}
