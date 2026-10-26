<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Laravel\GetChannelRequest;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
interface ChannelsEndpoints
{
    /**
     * Operation 'getChannel'.
     * @throws ApiSchemaInvalidError
     * @throws ApiUnauthenticatedError
     * @throws ApiNotFoundError
     * @throws ApiInternalError
     */
    public function getChannel(GetChannelRequest $request): GetChannelResult;
}
