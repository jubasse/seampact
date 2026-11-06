<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

/** The user ids of the credentials' user tokens, which every api's `user` identity double reads. */
final class UserTokens
{
    private function __construct()
    {
    }

    /** The user a token stands for, null for any other token. */
    public static function userIdOf(?string $token): ?string
    {
        $userIds = [
            Credentials::text('userToken') => Credentials::text('userId'),
            Credentials::text('throttledUserToken') => Credentials::text('throttledUserId'),
        ];

        return $token === null ? null : ($userIds[$token] ?? null);
    }
}
