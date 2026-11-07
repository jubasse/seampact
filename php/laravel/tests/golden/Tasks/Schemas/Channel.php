<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Schemas;

/**
 * The schema 'Channel'.
 */
final readonly class Channel
{
    public function __construct(
        public string $channelId,
        public string $name,
    ) {
    }
}
