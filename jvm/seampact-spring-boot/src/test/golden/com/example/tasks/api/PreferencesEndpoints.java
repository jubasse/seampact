package com.example.tasks.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface PreferencesEndpoints {
    @Operation(
            operationId = "getPreferences",
            responses = {
                    @ApiResponse(responseCode = "200", description = ""),
                    @ApiResponse(responseCode = "304", description = "")
            }
    )
    GetPreferencesResult getPreferences(@Parameter(hidden = true) GetPreferencesInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiNotFoundError, ApiInternalError;

    @Operation(
            operationId = "updatePreferences",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    UpdatePreferencesResult updatePreferences(
            @Parameter(hidden = true) UpdatePreferencesInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiCsrfInvalidError, ApiNotFoundError,
            ApiIdempotencyInProgressError, ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError,
            ApiIdempotencyKeyReusedError, ApiInternalError;
}
