<?php

declare(strict_types=1);

namespace App\Suite;

/** The principal the `user` identity's hook double authenticates. */
final readonly class UserPrincipal
{
    public function __construct(public string $userId)
    {
    }
}
