<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Schemas;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * The schema 'Channel'.
 */
final readonly class Channel
{
    public function __construct(
        #[Assert\NotNull]
        public string $channelId,
        #[Assert\NotNull, Assert\Length(min: 1, max: 100)]
        public string $name,
    ) {
    }
}
