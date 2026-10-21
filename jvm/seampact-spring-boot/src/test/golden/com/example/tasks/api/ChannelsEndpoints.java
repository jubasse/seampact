package com.example.tasks.api;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
public interface ChannelsEndpoints {
    GetChannelResult getChannel(GetChannelInput input) throws ApiSchemaInvalidError,
            ApiUnauthenticatedError, ApiNotFoundError, ApiInternalError;
}
