<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Schemas\Task;

/**
 * The 200 reply of operation 'archiveTask'.
 */
final readonly class ArchiveTaskResponse200 implements ArchiveTaskResult
{
    public function __construct(
        public Task $body,
    ) {
    }
}
