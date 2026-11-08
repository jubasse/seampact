<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

/**
 * The path parameters of operation 'archiveTask'.
 */
final readonly class ArchiveTaskPath
{
    public function __construct(
        public string $channelId,
        public string $taskId,
    ) {
    }
}
