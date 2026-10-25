package com.example.tasks.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface HooksEndpoints {
    @Operation(
            operationId = "payments",
            responses = @ApiResponse(responseCode = "204", description = "")
    )
    PaymentsResult payments(@Parameter(hidden = true) PaymentsInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiPayloadTooLargeError,
            ApiUnsupportedMediaTypeError, ApiInternalError;
}
