package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiRateLimitedParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Objects;

public final class ApiRateLimitedError extends TasksContractException {
    private static final long serialVersionUID = 1L;

    private final transient ApiRateLimitedParams params;

    public ApiRateLimitedError(@Valid @NotNull ApiRateLimitedParams params) {
        super("api.rate_limited");
        this.params = Objects.requireNonNull(params, "params");
    }

    @Override
    public String code() {
        return "api.rate_limited";
    }

    @Override
    public int status() {
        return 429;
    }

    @Override
    public String toString() {
        return "ApiRateLimitedError[code=" + this.code() + ", params=" + this.params() + "]";
    }

    public ApiRateLimitedParams params() {
        return params;
    }
}
