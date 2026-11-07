<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Schemas;

/**
 * The schema 'Draft'.
 */
final readonly class Draft
{
    public function __construct(
        public string $draftId,
        public string $body,
    ) {
    }
}
