<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The path parameters of operation 'createTask'.
 */
final readonly class CreateTaskPath
{
  public function __construct(
    public string $channelId,
  ) {
  }
}
