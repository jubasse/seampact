<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The input of operation 'getTasksBatch', as its handler reads it.
 */
final readonly class GetTasksBatchInput
{
  public function __construct(
    public GetTasksBatchPath $path,
    public Schemas\GetTasksBatchInput $body,
  ) {
  }
}
