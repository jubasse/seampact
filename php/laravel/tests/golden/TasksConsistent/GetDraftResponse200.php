<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\Draft;

/**
 * The 200 reply of operation 'getDraft'.
 */
final readonly class GetDraftResponse200 implements GetDraftResult
{
    public function __construct(
        public Draft $body,
    ) {
    }
}
