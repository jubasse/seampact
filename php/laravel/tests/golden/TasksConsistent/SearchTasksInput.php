<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\TaskQuery;

/**
 * The input of operation 'searchTasks', as its handler reads it.
 */
final readonly class SearchTasksInput
{
    public function __construct(
        public SearchTasksPath $path,
        public TaskQuery $body,
    ) {
    }
}
