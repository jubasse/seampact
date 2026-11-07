package com.example.tasksservice.api;

/**
 * A contract error a handler throws; the boundary renders it in the api's format.
 */
public abstract sealed class TasksServiceContractException extends Exception permits ApiSchemaInvalidError, ApiUnauthenticatedError, ApiForbiddenError, ApiNotFoundError, ApiInternalError, ApiDeadlineExceededError {
    private static final long serialVersionUID = 1L;

    protected TasksServiceContractException(String code) {
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
