<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/**
 * What a debug dump prints in place of a value that may carry a secret, so a logged object never leaks it.
 *
 * @internal
 */
final class Redaction
{
    public const REDACTED = '[redacted]';

    private function __construct()
    {
    }
}
