<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'CreateTask'.
 */
final readonly class CreateTask
{
  private const REDACTED = '[redacted]';

  public function __construct(
    #[Assert\NotNull, Assert\Length(min: 1, max: 200), \SensitiveParameter]
    public string $title,
    #[Assert\GreaterThanOrEqual(value: 0)]
    public ?int $effort,
  ) {
  }

  /**
   * @return array<string, mixed> each sensitive member redacted, so a dump never shows it
   */
  public function __debugInfo(): array
  {
    return [
      'title' => self::REDACTED,
      'effort' => $this->effort,
    ];
  }
}
