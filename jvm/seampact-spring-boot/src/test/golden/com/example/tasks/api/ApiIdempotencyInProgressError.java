package com.example.tasks.api;

public final class ApiIdempotencyInProgressError extends TasksContractException {
    private static final long serialVersionUID = 1L;

    public ApiIdempotencyInProgressError() {
        super("api.idempotency_in_progress");
    }

    @Override
    public String code() {
        return "api.idempotency_in_progress";
    }

    @Override
    public int status() {
        return 409;
    }

    @Override
    public String toString() {
        return "ApiIdempotencyInProgressError[code=" + this.code() + "]";
    }
}
