<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'TaskSearchResult'.
 */
final readonly class TaskSearchResult
{
    /**
     * @param list<Task> $items
     */
    public function __construct(
        public array $items,
        public ?int $total,
    ) {
    }
}
