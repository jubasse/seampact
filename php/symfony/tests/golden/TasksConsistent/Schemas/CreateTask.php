<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'CreateTask'.
 */
final readonly class CreateTask
{
  private const REDACTED = '[redacted]';

  public function __construct(
    #[\SensitiveParameter]
    public string $title,
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
