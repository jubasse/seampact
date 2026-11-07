<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

/**
 * The principal members of identity 'stripe' the boundary reads; its authenticate hook returns an object implementing it.
 */
interface StripePrincipalMembers
{
  public function account(): string;
}
