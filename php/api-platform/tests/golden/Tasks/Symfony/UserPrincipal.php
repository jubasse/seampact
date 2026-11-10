<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

/**
 * The principal of identity 'user', as the contract declares it.
 */
final readonly class UserPrincipal implements UserPrincipalMembers
{
    public function __construct(
        public string $userId,
    ) {
    }

    public function userId(): string
    {
        return $this->userId;
    }
}
