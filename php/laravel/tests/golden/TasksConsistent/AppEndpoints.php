<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
interface AppEndpoints
{
    /**
     * Operation 'health'.
     * @throws ApiSchemaInvalidError
     * @throws ApiInternalError
     */
    public function health(HealthRequest $request): HealthResult;
}
