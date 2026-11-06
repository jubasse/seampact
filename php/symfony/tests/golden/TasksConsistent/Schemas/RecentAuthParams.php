<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'RecentAuthParams'.
 */
final readonly class RecentAuthParams
{
  public function __construct(
    #[Assert\NotNull]
    public ReauthIntent $intent,
  ) {
  }
}
