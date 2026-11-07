package com.example.tasksservice.api;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface InternalEndpoints {
    GetTaskResult getTask(GetTaskInput input) throws ApiSchemaInvalidError, ApiUnauthenticatedError,
            ApiForbiddenError, ApiNotFoundError, ApiInternalError, ApiDeadlineExceededError;
}
