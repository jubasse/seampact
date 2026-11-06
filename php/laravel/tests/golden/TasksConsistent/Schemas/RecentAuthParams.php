<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'RecentAuthParams'.
 */
final readonly class RecentAuthParams
{
    public function __construct(
        public ReauthIntent $intent,
    ) {
    }
}
