package com.example.tasks.api;

public final class ApiIdempotencyKeyReusedError extends TasksContractException {
    private static final long serialVersionUID = 1L;

    public ApiIdempotencyKeyReusedError() {
        super("api.idempotency_key_reused");
    }

    @Override
    public String code() {
        return "api.idempotency_key_reused";
    }

    @Override
    public int status() {
        return 422;
    }

    @Override
    public String toString() {
        return "ApiIdempotencyKeyReusedError[code=" + this.code() + "]";
    }
}
