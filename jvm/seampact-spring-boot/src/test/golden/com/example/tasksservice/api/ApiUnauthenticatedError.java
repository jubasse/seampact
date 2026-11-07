package com.example.tasksservice.api;

public final class ApiUnauthenticatedError extends TasksServiceContractException {
    private static final long serialVersionUID = 1L;

    public ApiUnauthenticatedError() {
        super("api.unauthenticated");
    }

    @Override
    public String code() {
        return "api.unauthenticated";
    }

    @Override
    public int status() {
        return 401;
    }

    @Override
    public String toString() {
        return "ApiUnauthenticatedError[code=" + this.code() + "]";
    }
}
