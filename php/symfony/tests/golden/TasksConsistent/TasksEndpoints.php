<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The handlers a controller service implements, each method marked with the SeampactOperation
 * attribute of its operation; each returns a declared success or error, or throws a declared error.
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
  public function createTask(CreateTaskInput $input): CreateTaskResult;

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

  /**
   * Operation 'listTasks'.
   * @throws ApiSchemaInvalidError
   * @throws ApiUnauthenticatedError
   * @throws ApiNotFoundError
   * @throws ApiInternalError
   */
  public function listTasks(ListTasksInput $input): ListTasksResult;

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
  public function purgeTask(PurgeTaskInput $input): PurgeTaskResult;

  /**
   * Operation 'searchTasks'.
   * @throws ApiSchemaInvalidError
   * @throws ApiUnauthenticatedError
   * @throws ApiCsrfInvalidError
   * @throws ApiForbiddenError
   * @throws ApiNotFoundError
   * @throws ApiPayloadTooLargeError
   * @throws ApiUnsupportedMediaTypeError
   * @throws ApiInternalError
   */
  public function searchTasks(SearchTasksInput $input): SearchTasksResult;

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
  public function updateTask(UpdateTaskInput $input): UpdateTaskResult;
}
