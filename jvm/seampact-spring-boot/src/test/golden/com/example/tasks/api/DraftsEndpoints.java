package com.example.tasks.api;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface DraftsEndpoints {
    DeleteDraftResult deleteDraft(DeleteDraftInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiCsrfInvalidError, ApiNotFoundError,
            ApiIdempotencyInProgressError, ApiIdempotencyKeyReusedError, ApiInternalError;

    GetDraftResult getDraft(GetDraftInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiNotFoundError, ApiInternalError;
}
