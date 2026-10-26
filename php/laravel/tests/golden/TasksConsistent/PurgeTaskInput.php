<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Seampact\Golden\TasksConsistent\Schemas\ApiEmptyBody;

/**
 * The input of operation 'purgeTask', as its handler reads it.
 */
final readonly class PurgeTaskInput
{
    public function __construct(
        public PurgeTaskPath $path,
        public ApiEmptyBody $body,
    ) {
    }
}
