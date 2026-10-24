package com.example.tasks.api;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface AppEndpoints {
    HealthResult health(HealthInput input) throws ApiSchemaInvalidError, ApiInternalError;
}
