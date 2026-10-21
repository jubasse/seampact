package com.example.tasksservice.api;

import com.example.tasksservice.api.schemas.ApiSchemaInvalidParams;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.Objects;

public final class ApiSchemaInvalidError extends TasksServiceContractException {
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
        return "ApiSchemaInvalidError[code=" + code() + ", params=" + params() + "]";
    }

    public ApiSchemaInvalidParams params() {
        return params;
    }
}
