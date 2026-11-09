<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'ArchiveTask'.
 */
final readonly class ArchiveTask
{
    public function __construct(
        #[Assert\NotNull, Assert\Length(min: 1, max: 500)]
        public string $reason,
        #[Assert\NotNull, Assert\GreaterThanOrEqual(value: 1)]
        public int $expectedVersion,
    ) {
    }
}
