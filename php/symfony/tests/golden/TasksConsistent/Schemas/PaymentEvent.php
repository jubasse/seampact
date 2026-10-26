<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'PaymentEvent'.
 */
final readonly class PaymentEvent
{
  public function __construct(
    #[Assert\NotNull]
    public string $id,
    #[Assert\NotNull]
    public string $type,
    public mixed $data,
  ) {
  }
}
