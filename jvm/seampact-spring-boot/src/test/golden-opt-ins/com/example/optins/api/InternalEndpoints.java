package com.example.optins.api;

import com.example.optins.api.schemas.Task;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface InternalEndpoints {
    @Operation(
            operationId = "getTask",
            responses = @ApiResponse(responseCode = "200", description = "", content = @Content(mediaType = "application/json", schema = @Schema(implementation = Task.class)))
    )
    GetTaskResult getTask(@Parameter(hidden = true) GetTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiForbiddenError, ApiNotFoundError,
            ApiInternalError, ApiDeadlineExceededError;

    @Operation(
            operationId = "browseTask",
            responses = @ApiResponse(responseCode = "200", description = "", content = @Content(mediaType = "application/json", schema = @Schema(implementation = Task.class)))
    )
    BrowseTaskResult browseTask(@Parameter(hidden = true) BrowseTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiForbiddenError, ApiNotFoundError,
            ApiInternalError, ApiDeadlineExceededError;

    @Operation(
            operationId = "peekTask",
            responses = @ApiResponse(responseCode = "200", description = "", content = @Content(mediaType = "application/json", schema = @Schema(implementation = Task.class)))
    )
    PeekTaskResult peekTask(@Parameter(hidden = true) PeekTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiForbiddenError, ApiNotFoundError,
            ApiInternalError, ApiDeadlineExceededError;

    @Operation(
            operationId = "signTask",
            responses = @ApiResponse(responseCode = "200", description = "", content = @Content(mediaType = "application/json", schema = @Schema(implementation = Task.class)))
    )
    SignTaskResult signTask(@Parameter(hidden = true) SignTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiForbiddenError, ApiNotFoundError,
            ApiInternalError, ApiDeadlineExceededError;
}
