package com.example.tasks.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface DraftsEndpoints {
    @Operation(
            operationId = "deleteDraft",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    DeleteDraftResult deleteDraft(@Parameter(hidden = true) DeleteDraftInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiCsrfInvalidError, ApiNotFoundError,
            ApiIdempotencyInProgressError, ApiIdempotencyKeyReusedError, ApiInternalError;

    @Operation(
            operationId = "getDraft",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    GetDraftResult getDraft(@Parameter(hidden = true) GetDraftInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiNotFoundError, ApiInternalError;
}
