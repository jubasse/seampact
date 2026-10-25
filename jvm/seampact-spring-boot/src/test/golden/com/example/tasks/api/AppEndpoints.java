package com.example.tasks.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface AppEndpoints {
    @Operation(
            operationId = "health",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    HealthResult health(@Parameter(hidden = true) HealthInput input) throws ApiSchemaInvalidError,
            ApiInternalError;
}
