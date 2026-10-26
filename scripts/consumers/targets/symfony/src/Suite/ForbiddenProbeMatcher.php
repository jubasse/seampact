<?php

declare(strict_types=1);

namespace App\Suite;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestMatcherInterface;

/** Matches a request carrying the suite's probe header, so its `access_control` rule denies it a role. */
final class ForbiddenProbeMatcher implements RequestMatcherInterface
{
    public const HEADER = 'x-seampact-suite-forbidden';

    public function matches(Request $request): bool
    {
        return $request->headers->has(self::HEADER);
    }
}
