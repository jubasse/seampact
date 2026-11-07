package com.example.tasks.api;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface PreferencesEndpoints {
    GetPreferencesResult getPreferences(GetPreferencesInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiNotFoundError, ApiInternalError;

    UpdatePreferencesResult updatePreferences(UpdatePreferencesInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiCsrfInvalidError, ApiNotFoundError,
            ApiIdempotencyInProgressError, ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError,
            ApiIdempotencyKeyReusedError, ApiInternalError;
}
