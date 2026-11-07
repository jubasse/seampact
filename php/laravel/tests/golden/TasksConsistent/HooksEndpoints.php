<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
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
    public function payments(PaymentsRequest $request): PaymentsResult;
}
