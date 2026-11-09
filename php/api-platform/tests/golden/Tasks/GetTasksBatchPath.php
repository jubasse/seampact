<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

/**
 * The path parameters of operation 'getTasksBatch'.
 */
final readonly class GetTasksBatchPath
{
    public function __construct(
        public string $channelId,
    ) {
    }
}
