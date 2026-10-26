<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The path parameters of operation 'getDraft'.
 */
final readonly class GetDraftPath
{
  public function __construct(
    public string $draftId,
  ) {
  }
}
