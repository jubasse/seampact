<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

/**
 * The path parameters of operation 'getChannel'.
 */
final readonly class GetChannelPath
{
    public function __construct(
        public string $channelId,
    ) {
    }
}
