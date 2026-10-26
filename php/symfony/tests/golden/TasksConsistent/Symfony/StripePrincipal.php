<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

/**
 * The principal of identity 'stripe', as the contract declares it.
 */
final readonly class StripePrincipal implements StripePrincipalMembers
{
  public function __construct(
    public string $account,
  ) {
  }

  public function account(): string
  {
    return $this->account;
  }
}
