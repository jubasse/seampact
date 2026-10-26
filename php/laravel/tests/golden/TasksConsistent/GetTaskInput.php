<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The input of operation 'getTask', as its handler reads it.
 */
final readonly class GetTaskInput
{
    public function __construct(
        public GetTaskPath $path,
    ) {
    }
}
