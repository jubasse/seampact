<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The path parameters of operation 'listTasks'.
 */
final readonly class ListTasksPath
{
    public function __construct(
        public string $channelId,
    ) {
    }
}
