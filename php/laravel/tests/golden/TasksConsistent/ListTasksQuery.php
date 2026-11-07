<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\TaskState;

/**
 * The query parameters of operation 'listTasks'.
 */
final readonly class ListTasksQuery
{
    /**
     * @param list<TaskState>|null $state
     * @param list<string>|null $sort
     */
    public function __construct(
        public ?array $state,
        public ?string $cursor,
        public ?int $limit,
        public ?array $sort,
    ) {
    }
}
