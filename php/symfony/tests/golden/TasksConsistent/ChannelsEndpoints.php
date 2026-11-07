<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The handlers a controller service implements, each method marked with the SeampactOperation
 * attribute of its operation; each returns a declared success or error, or throws a declared error.
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
  public function getChannel(GetChannelInput $input): GetChannelResult;
}
