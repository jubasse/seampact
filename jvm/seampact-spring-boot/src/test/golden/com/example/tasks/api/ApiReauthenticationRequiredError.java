package com.example.tasks.api;

public final class ApiReauthenticationRequiredError extends TasksContractException {
    private static final long serialVersionUID = 1L;

    public ApiReauthenticationRequiredError() {
        super("api.reauthentication_required");
    }

    @Override
    public String code() {
        return "api.reauthentication_required";
    }

    @Override
    public int status() {
        return 401;
    }

    @Override
    public String toString() {
        return "ApiReauthenticationRequiredError[code=" + this.code() + "]";
    }
}
