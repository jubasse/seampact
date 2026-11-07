<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\Task;

/**
 * The page operation 'listTasks' answers: its items and the facts its paging style reads.
 */
final readonly class ListTasksPage
{
    /**
     * @param list<Task> $items
     */
    public function __construct(
        public array $items,
        public ?string $nextCursor = null,
    ) {
    }
}
