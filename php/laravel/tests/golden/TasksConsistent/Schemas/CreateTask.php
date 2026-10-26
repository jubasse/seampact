<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'CreateTask'.
 */
final readonly class CreateTask
{
    public function __construct(
        public string $title,
        public ?int $effort,
    ) {
    }
}
