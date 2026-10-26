<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

/** The `tasksService` api's fixed service JWTs: each names the service it stands for, accepted as is. */
final class ServiceTokens
{
    private function __construct()
    {
    }

    /** The service a token names, null for any other token. */
    public static function serviceNameOf(?string $token): ?string
    {
        $services = [
            Credentials::text('serviceJwt') => Credentials::text('serviceName'),
            Credentials::text('foreignServiceJwt') => Credentials::text('foreignServiceName'),
        ];

        return $token === null ? null : ($services[$token] ?? null);
    }
}
