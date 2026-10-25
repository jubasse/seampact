package com.example.tasks.api;

/**
 * A contract error a handler throws; the boundary renders it in the api's format.
 */
public abstract sealed class TasksContractException extends Exception permits ApiSchemaInvalidError, ApiUnauthenticatedError, ApiCsrfInvalidError, ApiNotFoundError, ApiIdempotencyInProgressError, StateConflictError, ApiPayloadTooLargeError, ApiUnsupportedMediaTypeError, ApiIdempotencyKeyReusedError, ApiInternalError, ApiForbiddenError, ApiRateLimitedError, ApiReauthenticationRequiredError {
    private static final long serialVersionUID = 1L;

    protected TasksContractException(String code) {
        super(code);
    }

    /**
     * The error code.
     */
    public abstract String code();

    /**
     * The HTTP status the code answers.
     */
    public abstract int status();
}
