<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'PaymentEvent'.
 */
final readonly class PaymentEvent
{
  public function __construct(
    public string $id,
    public string $type,
    public mixed $data,
  ) {
  }
}
