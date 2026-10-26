<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Schemas\Draft;

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
