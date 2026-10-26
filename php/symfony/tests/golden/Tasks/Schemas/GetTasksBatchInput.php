<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'GetTasksBatchInput'.
 */
final readonly class GetTasksBatchInput
{
    /**
     * @param list<string> $ids
     */
    public function __construct(
        #[Assert\NotNull, Assert\Count(max: 200), Assert\All(constraints: [new Assert\NotNull()])]
        public array $ids,
    ) {
    }
}
