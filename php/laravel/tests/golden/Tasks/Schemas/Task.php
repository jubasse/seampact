<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Schemas;

use DateTimeImmutable;

/**
 * The schema 'Task'.
 */
final readonly class Task
{
    public function __construct(
        public string $taskId,
        public string $title,
        public TaskState $state,
        public ?int $effort,
        public int $version,
        public DateTimeImmutable $createdAt,
    ) {
    }
}
