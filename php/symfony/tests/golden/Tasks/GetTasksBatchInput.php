<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Seampact\Golden\Tasks\Symfony\UserPrincipal;

/**
 * The input of operation 'getTasksBatch', as its handler reads it.
 */
final readonly class GetTasksBatchInput
{
    public function __construct(
        public GetTasksBatchPath $path,
        public Schemas\GetTasksBatchInput $body,
        public UserPrincipal $principal,
        public GetTasksBatchScopes $scopes,
    ) {
    }
}
