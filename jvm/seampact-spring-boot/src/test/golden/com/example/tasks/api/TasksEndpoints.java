package com.example.tasks.api;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface TasksEndpoints {
    GetTaskResult getTask(GetTaskInput input) throws ApiSchemaInvalidError, ApiUnauthenticatedError,
            ApiNotFoundError, ApiInternalError;

    GetTasksBatchResult getTasksBatch(GetTasksBatchInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiNotFoundError, ApiPayloadTooLargeError,
            ApiUnsupportedMediaTypeError, ApiInternalError;

    ListTasksResult listTasks(ListTasksInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiNotFoundError, ApiInternalError;

    SearchTasksResult searchTasks(SearchTasksInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiCsrfInvalidError, ApiForbiddenError, ApiNotFoundError,
            ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError, ApiInternalError;
}
