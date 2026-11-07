<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\CreateTask;

/**
 * The input of operation 'createTask', as its handler reads it.
 */
final readonly class CreateTaskInput
{
    public function __construct(
        public CreateTaskPath $path,
        public CreateTaskHeaders $headers,
        public CreateTask $body,
    ) {
    }
}
