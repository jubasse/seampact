<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Schemas\Channel;

/**
 * The 200 reply of operation 'getChannel'.
 */
final readonly class GetChannelResponse200 implements GetChannelResult
{
    public function __construct(
        public Channel $body,
    ) {
    }
}
