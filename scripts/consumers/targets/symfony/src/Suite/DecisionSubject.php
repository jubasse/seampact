<?php

declare(strict_types=1);

namespace App\Suite;

/** The subject a decider passes to `isGranted`: the requirement's params and the resolved scopes, which voters read. */
final readonly class DecisionSubject
{
    /** @param array<array-key, mixed> $scopes */
    public function __construct(public ?object $params, public array $scopes)
    {
    }
}
