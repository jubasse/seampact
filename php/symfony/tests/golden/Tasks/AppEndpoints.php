<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

/**
 * The handlers a controller service implements, each method marked with the SeampactOperation
 * attribute of its operation; each returns a declared success or error, or throws a declared error.
 */
interface AppEndpoints
{
    /**
     * Operation 'health'.
     * @throws ApiSchemaInvalidError
     * @throws ApiInternalError
     */
    public function health(HealthInput $input): HealthResult;
}
