<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Schemas;

/**
 * The schema 'ApiSchemaInvalidParams'.
 */
final readonly class ApiSchemaInvalidParams
{
    /**
     * @param list<IssuesItem> $issues
     */
    public function __construct(
        public array $issues,
    ) {
    }
}
