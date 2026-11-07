package com.example.tasksservice.api;

public final class ApiNotFoundError extends TasksServiceContractException {
    private static final long serialVersionUID = 1L;

    public ApiNotFoundError() {
        super("api.not_found");
    }

    @Override
    public String code() {
        return "api.not_found";
    }

    @Override
    public int status() {
        return 404;
    }

    @Override
    public String toString() {
        return "ApiNotFoundError[code=" + this.code() + "]";
    }
}
