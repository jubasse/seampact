package com.example.optins.api;

public final class ApiInternalError extends TasksServiceContractException {
    private static final long serialVersionUID = 1L;

    public ApiInternalError() {
        super("api.internal");
    }

    @Override
    public String code() {
        return "api.internal";
    }

    @Override
    public int status() {
        return 500;
    }

    @Override
    public String toString() {
        return "ApiInternalError[code=" + this.code() + "]";
    }
}
