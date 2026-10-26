<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Laravel\CreateTaskRequest;
use Seampact\Golden\TasksConsistent\Laravel\GetTaskRequest;
use Seampact\Golden\TasksConsistent\Laravel\GetTasksBatchRequest;
use Seampact\Golden\TasksConsistent\Laravel\PurgeTaskRequest;
use Seampact\Golden\TasksConsistent\Laravel\UpdateTaskRequest;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
interface TasksEndpoints
{
    /**
     * Operation 'createTask'.
     * @throws ApiSchemaInvalidError
     * @throws ApiUnauthenticatedError
     * @throws ApiCsrfInvalidError
     * @throws ApiForbiddenError
     * @throws ApiNotFoundError
     * @throws ApiIdempotencyInProgressError
     * @throws ApiPayloadTooLargeError
     * @throws ApiUnsupportedMediaTypeError
     * @throws ApiIdempotencyKeyReusedError
     * @throws ApiRateLimitedError
     * @throws ApiInternalError
     */
    public function createTask(CreateTaskRequest $request): CreateTaskResult;

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

    /**
     * Operation 'purgeTask'.
     * @throws ApiSchemaInvalidError
     * @throws ApiReauthenticationRequiredError
     * @throws ApiUnauthenticatedError
     * @throws ApiCsrfInvalidError
     * @throws ApiNotFoundError
     * @throws ApiIdempotencyInProgressError
     * @throws ApiPayloadTooLargeError
     * @throws ApiUnsupportedMediaTypeError
     * @throws ApiIdempotencyKeyReusedError
     * @throws ApiInternalError
     */
    public function purgeTask(PurgeTaskRequest $request): PurgeTaskResult;

    /**
     * Operation 'updateTask'.
     * @throws ApiSchemaInvalidError
     * @throws ApiUnauthenticatedError
     * @throws ApiCsrfInvalidError
     * @throws ApiForbiddenError
     * @throws ApiNotFoundError
     * @throws ApiIdempotencyInProgressError
     * @throws StateConflictError
     * @throws ApiPayloadTooLargeError
     * @throws ApiUnsupportedMediaTypeError
     * @throws ApiIdempotencyKeyReusedError
     * @throws ApiInternalError
     */
    public function updateTask(UpdateTaskRequest $request): UpdateTaskResult;
}
