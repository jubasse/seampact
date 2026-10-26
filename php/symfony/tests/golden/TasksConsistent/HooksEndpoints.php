<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The handlers a controller service implements, each method marked with the SeampactOperation
 * attribute of its operation; each returns a declared success or error, or throws a declared error.
 */
interface HooksEndpoints
{
  /**
   * Operation 'payments'.
   * @throws ApiSchemaInvalidError
   * @throws ApiUnauthenticatedError
   * @throws ApiPayloadTooLargeError
   * @throws ApiUnsupportedMediaTypeError
   * @throws ApiInternalError
   */
  public function payments(PaymentsInput $input): PaymentsResult;
}
