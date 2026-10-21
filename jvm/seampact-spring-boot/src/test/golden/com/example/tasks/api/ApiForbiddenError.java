package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiForbiddenParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Objects;

public final class ApiForbiddenError extends TasksContractException {
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
        return "ApiForbiddenError[code=" + code() + ", params=" + params() + "]";
    }

    public ApiForbiddenParams params() {
        return params;
    }
}
