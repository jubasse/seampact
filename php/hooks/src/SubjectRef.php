<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** The subject a right is checked against: its type, its id, and the record when the boundary loaded it. */
final readonly class SubjectRef
{
    public function __construct(
        public string $type,
        public int|string|object $id,
        public mixed $record = null,
    ) {
    }
}
