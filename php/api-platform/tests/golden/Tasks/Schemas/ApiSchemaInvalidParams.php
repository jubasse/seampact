<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'ApiSchemaInvalidParams'.
 */
final readonly class ApiSchemaInvalidParams
{
    /**
     * @param list<IssuesItem> $issues
     */
    public function __construct(
        #[Assert\NotNull, Assert\Valid, Assert\All(constraints: [new Assert\NotNull()])]
        public array $issues,
    ) {
    }
}
