<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

/**
 * The path parameters of operation 'getTask'.
 */
final readonly class GetTaskPath
{
    public function __construct(
        public string $channelId,
        public string $taskId,
    ) {
    }
}
