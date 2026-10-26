<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Laravel\GetTaskRequest;
use Seampact\Golden\TasksConsistent\Laravel\GetTasksBatchRequest;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
interface TasksEndpoints
{
    /**
     * Operation 'getTask'.
     * @throws ApiSchemaInvalidError
     * @throws ApiUnauthenticatedError
     * @throws ApiNotFoundError
     * @throws ApiInternalError
     */
    public function getTask(GetTaskRequest $request): GetTaskResult;

    /**
     * Operation 'getTasksBatch'.
     * @throws ApiSchemaInvalidError
     * @throws ApiUnauthenticatedError
     * @throws ApiNotFoundError
     * @throws ApiPayloadTooLargeError
     * @throws ApiUnsupportedMediaTypeError
     * @throws ApiInternalError
     */
    public function getTasksBatch(GetTasksBatchRequest $request): GetTasksBatchResult;
}
