<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Schemas\Health;

/**
 * The 200 reply of operation 'health'.
 */
final readonly class HealthResponse200 implements HealthResult
{
    public function __construct(
        public Health $body,
    ) {
    }
}
