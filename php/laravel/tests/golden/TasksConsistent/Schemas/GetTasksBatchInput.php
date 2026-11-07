<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'GetTasksBatchInput'.
 */
final readonly class GetTasksBatchInput
{
    /**
     * @param list<string> $ids
     */
    public function __construct(
        public array $ids,
    ) {
    }
}
