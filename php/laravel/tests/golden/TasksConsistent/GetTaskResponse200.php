<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\Task;

/**
 * The 200 reply of operation 'getTask'.
 */
final readonly class GetTaskResponse200 implements GetTaskResult
{
    public function __construct(
        public Task $body,
    ) {
    }
}
