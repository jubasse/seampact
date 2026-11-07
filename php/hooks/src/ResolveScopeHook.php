<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/**
 * Resolves one scope.
 *
 * @template TRequest of ResolveScopeRequest
 */
interface ResolveScopeHook
{
    /** @param TRequest $request */
    public function resolveScope(ResolveScopeRequest $request): ScopeResolution;
}
