<?php

declare(strict_types=1);

namespace Seampact\Hooks\StoredResponse;

use Seampact\Hooks\Redaction;

/** One header of a stored response; its value never reaches a debug dump. */
final readonly class Header
{
    public function __construct(
        public string $name,
        public string $value,
    ) {
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['name' => $this->name, 'value' => Redaction::REDACTED];
    }
}
