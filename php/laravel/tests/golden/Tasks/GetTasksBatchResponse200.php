<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Schemas\Task;

/**
 * The 200 reply of operation 'getTasksBatch'.
 */
final readonly class GetTasksBatchResponse200 implements GetTasksBatchResult
{
    /**
     * @param array<string, Task> $body
     */
    public function __construct(
        public array $body,
    ) {
    }
}
