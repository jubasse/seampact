package com.example.tasks.api;

import com.example.tasks.api.schemas.ApiSchemaInvalidParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Objects;

public final class ApiSchemaInvalidError extends TasksContractException {
    private static final long serialVersionUID = 1L;

    private final transient ApiSchemaInvalidParams params;

    public ApiSchemaInvalidError(@Valid @NotNull ApiSchemaInvalidParams params) {
        super("api.schema_invalid");
        this.params = Objects.requireNonNull(params, "params");
    }

    @Override
    public String code() {
        return "api.schema_invalid";
    }

    @Override
    public int status() {
        return 400;
    }

    @Override
    public String toString() {
        return "ApiSchemaInvalidError[code=" + this.code() + ", params=" + this.params() + "]";
    }

    public ApiSchemaInvalidParams params() {
        return params;
    }
}
