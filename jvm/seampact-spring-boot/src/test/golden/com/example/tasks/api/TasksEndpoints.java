package com.example.tasks.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface TasksEndpoints {
    @Operation(
            operationId = "archiveTask",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    ArchiveTaskResult archiveTask(@Parameter(hidden = true) ArchiveTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiCsrfInvalidError, ApiNotFoundError,
            ApiIdempotencyInProgressError, StateConflictError, ApiPayloadTooLargeError,
            ApiUnsupportedMediaTypeError, ApiIdempotencyKeyReusedError, ApiInternalError;

    @Operation(
            operationId = "assignTask",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    AssignTaskResult assignTask(@Parameter(hidden = true) AssignTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiCsrfInvalidError, ApiForbiddenError,
            ApiNotFoundError, ApiIdempotencyInProgressError, ApiPayloadTooLargeError,
            ApiUnsupportedMediaTypeError, ApiIdempotencyKeyReusedError, ApiInternalError;

    @Operation(
            operationId = "createTask",
            responses = @ApiResponse(responseCode = "201", description = "")
    )
    CreateTaskResult createTask(@Parameter(hidden = true) CreateTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiCsrfInvalidError, ApiForbiddenError,
            ApiNotFoundError, ApiIdempotencyInProgressError, ApiPayloadTooLargeError,
            ApiUnsupportedMediaTypeError, ApiIdempotencyKeyReusedError, ApiRateLimitedError,
            ApiInternalError;

    @Operation(
            operationId = "getTask",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    GetTaskResult getTask(@Parameter(hidden = true) GetTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiNotFoundError, ApiInternalError;

    @Operation(
            operationId = "getTasksBatch",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    GetTasksBatchResult getTasksBatch(@Parameter(hidden = true) GetTasksBatchInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiNotFoundError,
            ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError, ApiInternalError;

    @Operation(
            operationId = "listTasks",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    ListTasksResult listTasks(@Parameter(hidden = true) ListTasksInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiNotFoundError, ApiInternalError;

    @Operation(
            operationId = "purgeTask",
            responses = @ApiResponse(responseCode = "204", description = "")
    )
    PurgeTaskResult purgeTask(@Parameter(hidden = true) PurgeTaskInput input) throws
            ApiSchemaInvalidError, ApiReauthenticationRequiredError, ApiUnauthenticatedError,
            ApiCsrfInvalidError, ApiNotFoundError, ApiIdempotencyInProgressError,
            ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError, ApiIdempotencyKeyReusedError,
            ApiInternalError;

    @Operation(
            operationId = "searchTasks",
            summary = "Search the channel's tasks with a structured query.",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    SearchTasksResult searchTasks(@Parameter(hidden = true) SearchTasksInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiCsrfInvalidError, ApiForbiddenError,
            ApiNotFoundError, ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError,
            ApiInternalError;

    @Operation(
            operationId = "updateTask",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    UpdateTaskResult updateTask(@Parameter(hidden = true) UpdateTaskInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiCsrfInvalidError, ApiForbiddenError,
            ApiNotFoundError, ApiIdempotencyInProgressError, StateConflictError,
            ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError, ApiIdempotencyKeyReusedError,
            ApiInternalError;
}
