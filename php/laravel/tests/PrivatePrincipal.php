<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Seampact\Golden\TasksConsistent\Laravel\UserPrincipalMembers;

/** An app's own principal, whose state is private and read only through the generated accessor interface. */
final readonly class PrivatePrincipal implements UserPrincipalMembers
{
    public function __construct(private string $id)
    {
    }

    public function userId(): string
    {
        return $this->id;
    }
}
