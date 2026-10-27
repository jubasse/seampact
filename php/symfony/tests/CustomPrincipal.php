<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use Seampact\Golden\TasksConsistent\Symfony\UserPrincipalMembers;

/** A principal an app returns in its own class, with a member the contract does not declare. */
final readonly class CustomPrincipal implements UserPrincipalMembers
{
    public function __construct(private string $id, public string $undeclaredSecret = 'not for the handler')
    {
    }

    public function userId(): string
    {
        return $this->id;
    }
}
