package com.example.tasksservice.api;

public final class ApiDeadlineExceededError extends TasksServiceContractException {
    private static final long serialVersionUID = 1L;

    public ApiDeadlineExceededError() {
        super("api.deadline_exceeded");
    }

    @Override
    public String code() {
        return "api.deadline_exceeded";
    }

    @Override
    public int status() {
        return 504;
    }

    @Override
    public String toString() {
        return "ApiDeadlineExceededError[code=" + code() + "]";
    }
}
