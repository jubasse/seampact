package com.example.tasks.api;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface TasksEndpoints {
    ArchiveTaskResult archiveTask(ArchiveTaskInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiCsrfInvalidError, ApiNotFoundError,
            ApiIdempotencyInProgressError, StateConflictError, ApiPayloadTooLargeError,
            ApiUnsupportedMediaTypeError, ApiIdempotencyKeyReusedError, ApiInternalError;

    AssignTaskResult assignTask(AssignTaskInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiCsrfInvalidError, ApiForbiddenError, ApiNotFoundError,
            ApiIdempotencyInProgressError, ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError,
            ApiIdempotencyKeyReusedError, ApiInternalError;

    CreateTaskResult createTask(CreateTaskInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiCsrfInvalidError, ApiForbiddenError, ApiNotFoundError,
            ApiIdempotencyInProgressError, ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError,
            ApiIdempotencyKeyReusedError, ApiRateLimitedError, ApiInternalError;

    GetTaskResult getTask(GetTaskInput input) throws ApiSchemaInvalidError, ApiUnauthenticatedError,
            ApiNotFoundError, ApiInternalError;

    GetTasksBatchResult getTasksBatch(GetTasksBatchInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiNotFoundError, ApiPayloadTooLargeError,
            ApiUnsupportedMediaTypeError, ApiInternalError;

    ListTasksResult listTasks(ListTasksInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiNotFoundError, ApiInternalError;

    PurgeTaskResult purgeTask(PurgeTaskInput input) throws ApiSchemaInvalidError,
            ApiReauthenticationRequiredError, ApiUnauthenticatedError, ApiCsrfInvalidError,
            ApiNotFoundError, ApiIdempotencyInProgressError, ApiPayloadTooLargeError,
            ApiUnsupportedMediaTypeError, ApiIdempotencyKeyReusedError, ApiInternalError;

    SearchTasksResult searchTasks(SearchTasksInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiCsrfInvalidError, ApiForbiddenError, ApiNotFoundError,
            ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError, ApiInternalError;

    UpdateTaskResult updateTask(UpdateTaskInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiCsrfInvalidError, ApiForbiddenError, ApiNotFoundError,
            ApiIdempotencyInProgressError, StateConflictError, ApiPayloadTooLargeError,
            ApiUnsupportedMediaTypeError, ApiIdempotencyKeyReusedError, ApiInternalError;
}
