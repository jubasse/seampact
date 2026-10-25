package com.example.optins.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface InternalEndpoints {
    @Operation(
            operationId = "getTask",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    GetTaskResult getTask(@Parameter(hidden = true) GetTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiForbiddenError, ApiNotFoundError,
            ApiInternalError, ApiDeadlineExceededError;

    @Operation(
            operationId = "browseTask",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    BrowseTaskResult browseTask(@Parameter(hidden = true) BrowseTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiForbiddenError, ApiNotFoundError,
            ApiInternalError, ApiDeadlineExceededError;

    @Operation(
            operationId = "peekTask",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    PeekTaskResult peekTask(@Parameter(hidden = true) PeekTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiForbiddenError, ApiNotFoundError,
            ApiInternalError, ApiDeadlineExceededError;

    @Operation(
            operationId = "signTask",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    SignTaskResult signTask(@Parameter(hidden = true) SignTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiForbiddenError, ApiNotFoundError,
            ApiInternalError, ApiDeadlineExceededError;
}
