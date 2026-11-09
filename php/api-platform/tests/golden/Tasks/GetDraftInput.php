<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Symfony\UserPrincipal;

/**
 * The input of operation 'getDraft', as its handler reads it.
 */
final readonly class GetDraftInput
{
    private const REDACTED = '[redacted]';

    public function __construct(
        public GetDraftPath $path,
        #[\SensitiveParameter]
        private UserPrincipal $principal,
    ) {
    }

    /**
     * The caller.
     */
    public function principal(): UserPrincipal
    {
        return $this->principal;
    }

    /**
     * @return array<string, mixed> each sensitive member redacted, so a dump never shows it
     */
    public function __debugInfo(): array
    {
        return [
            'path' => $this->path,
            'principal' => self::REDACTED,
        ];
    }
}
