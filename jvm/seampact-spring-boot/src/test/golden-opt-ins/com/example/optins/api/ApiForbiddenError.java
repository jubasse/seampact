package com.example.optins.api;

import com.example.optins.api.schemas.ApiForbiddenParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Objects;

public final class ApiForbiddenError extends TasksServiceContractException {
    private static final long serialVersionUID = 1L;

    private final transient ApiForbiddenParams params;

    public ApiForbiddenError(@Valid @NotNull ApiForbiddenParams params) {
        super("api.forbidden");
        this.params = Objects.requireNonNull(params, "params");
    }

    @Override
    public String code() {
        return "api.forbidden";
    }

    @Override
    public int status() {
        return 403;
    }

    @Override
    public String toString() {
        return "ApiForbiddenError[code=" + this.code() + ", params=" + this.params() + "]";
    }

    public ApiForbiddenParams params() {
        return params;
    }
}
