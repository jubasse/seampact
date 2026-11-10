<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Schemas\ArchiveTask;
use Seampact\Golden\Tasks\Symfony\UserPrincipal;

/**
 * The input of operation 'archiveTask', as its handler reads it.
 */
final readonly class ArchiveTaskInput
{
    private const REDACTED = '[redacted]';

    public function __construct(
        public ArchiveTaskPath $path,
        public ArchiveTaskHeaders $headers,
        public ArchiveTask $body,
        #[\SensitiveParameter]
        private UserPrincipal $principal,
        #[\SensitiveParameter]
        private ArchiveTaskScopes $scopes,
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
     * The scopes the operation runs in, as their resolvers resolved them.
     */
    public function scopes(): ArchiveTaskScopes
    {
        return $this->scopes;
    }

    /**
     * @return array<string, mixed> each sensitive member redacted, so a dump never shows it
     */
    public function __debugInfo(): array
    {
        return [
            'path' => $this->path,
            'headers' => $this->headers,
            'body' => $this->body,
            'principal' => self::REDACTED,
            'scopes' => self::REDACTED,
        ];
    }
}
