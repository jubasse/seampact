package com.example.tasks.api;

public final class ApiUnsupportedMediaTypeError extends TasksContractException {
    private static final long serialVersionUID = 1L;

    public ApiUnsupportedMediaTypeError() {
        super("api.unsupported_media_type");
    }

    @Override
    public String code() {
        return "api.unsupported_media_type";
    }

    @Override
    public int status() {
        return 415;
    }

    @Override
    public String toString() {
        return "ApiUnsupportedMediaTypeError[code=" + code() + "]";
    }
}
