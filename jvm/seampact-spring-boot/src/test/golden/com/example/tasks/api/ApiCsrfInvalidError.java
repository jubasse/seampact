package com.example.tasks.api;

public final class ApiCsrfInvalidError extends TasksContractException {
    private static final long serialVersionUID = 1L;

    public ApiCsrfInvalidError() {
        super("api.csrf_invalid");
    }

    @Override
    public String code() {
        return "api.csrf_invalid";
    }

    @Override
    public int status() {
        return 403;
    }

    @Override
    public String toString() {
        return "ApiCsrfInvalidError[code=" + code() + "]";
    }
}
