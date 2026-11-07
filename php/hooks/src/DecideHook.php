<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/**
 * Decides one right or rule.
 *
 * @template TRequest of RequirementRequest
 */
interface DecideHook
{
    /** @param TRequest $request */
    public function decide(RequirementRequest $request): Decision;
}
