<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** The bucket a throttle rule counts in: its id, its key, the key values, and the declared limit and window. */
final readonly class ThrottleBucket
{
    /**
     * @param list<mixed> $values the values of the key sources, in order; a source may hold null
     */
    public function __construct(
        public string $id,
        public string $key,
        public array $values,
        public ?int $limit = null,
        public ?int $windowMs = null,
    ) {
    }
}
