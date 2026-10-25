package com.example.tasks.api;

public final class StateConflictError extends TasksContractException {
    private static final long serialVersionUID = 1L;

    public StateConflictError() {
        super("state.conflict");
    }

    @Override
    public String code() {
        return "state.conflict";
    }

    @Override
    public int status() {
        return 409;
    }

    @Override
    public String toString() {
        return "StateConflictError[code=" + this.code() + "]";
    }
}
