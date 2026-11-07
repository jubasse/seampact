<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel;

/**
 * The principal members of identity 'user' the boundary reads; its authenticate hook returns an object implementing it.
 */
interface UserPrincipalMembers
{
    public function userId(): string;
}
