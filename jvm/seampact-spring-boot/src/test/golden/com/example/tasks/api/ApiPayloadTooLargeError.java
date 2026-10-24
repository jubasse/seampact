package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiPayloadTooLargeParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Objects;

public final class ApiPayloadTooLargeError extends TasksContractException {
    private static final long serialVersionUID = 1L;

    private final transient ApiPayloadTooLargeParams params;

    public ApiPayloadTooLargeError(@Valid @NotNull ApiPayloadTooLargeParams params) {
        super("api.payload_too_large");
        this.params = Objects.requireNonNull(params, "params");
    }

    @Override
    public String code() {
        return "api.payload_too_large";
    }

    @Override
    public int status() {
        return 413;
    }

    @Override
    public String toString() {
        return "ApiPayloadTooLargeError[code=" + this.code() + ", params=" + this.params() + "]";
    }

    public ApiPayloadTooLargeParams params() {
        return params;
    }
}
