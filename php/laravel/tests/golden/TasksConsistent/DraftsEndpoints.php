<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The handlers a controller implements; each returns a declared success or error, or throws a declared error.
 */
interface DraftsEndpoints
{
    /**
     * Operation 'getDraft'.
     * @throws ApiSchemaInvalidError
     * @throws ApiUnauthenticatedError
     * @throws ApiNotFoundError
     * @throws ApiInternalError
     */
    public function getDraft(GetDraftRequest $request): GetDraftResult;
}
