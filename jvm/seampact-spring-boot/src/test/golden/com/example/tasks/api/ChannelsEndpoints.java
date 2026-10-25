package com.example.tasks.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface ChannelsEndpoints {
    @Operation(
            operationId = "getChannel",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    GetChannelResult getChannel(@Parameter(hidden = true) GetChannelInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiNotFoundError, ApiInternalError;

    @Operation(
            operationId = "listChannels",
            responses = @ApiResponse(responseCode = "200", description = "")
    )
    ListChannelsResult listChannels(@Parameter(hidden = true) ListChannelsInput input) throws
            ApiSchemaInvalidError, ApiUnauthenticatedError, ApiInternalError;
}
