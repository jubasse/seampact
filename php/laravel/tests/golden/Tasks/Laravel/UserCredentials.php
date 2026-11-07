<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel;

/**
 * The credentials a request presents for identity 'user', one per scheme, null when absent.
 */
final readonly class UserCredentials
{
    private const REDACTED = '[redacted]';

    public function __construct(
        public ?string $bearer,
        public ?string $sessionCookie,
    ) {
    }

    /**
     * @return array<string, ?string> each credential redacted, so a dump never shows it
     */
    public function __debugInfo(): array
    {
        return [
            'bearer' => $this->bearer === null ? null : self::REDACTED,
            'sessionCookie' => $this->sessionCookie === null ? null : self::REDACTED,
        ];
    }
}
