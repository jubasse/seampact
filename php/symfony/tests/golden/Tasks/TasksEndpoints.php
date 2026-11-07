<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

/**
 * The handlers a controller service implements, each method marked with the SeampactOperation
 * attribute of its operation; each returns a declared success or error, or throws a declared error.
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
    public function getTask(GetTaskInput $input): GetTaskResult;

    /**
     * Operation 'getTasksBatch'.
     * @throws ApiSchemaInvalidError
     * @throws ApiUnauthenticatedError
     * @throws ApiNotFoundError
     * @throws ApiPayloadTooLargeError
     * @throws ApiUnsupportedMediaTypeError
     * @throws ApiInternalError
     */
    public function getTasksBatch(GetTasksBatchInput $input): GetTasksBatchResult;
}
