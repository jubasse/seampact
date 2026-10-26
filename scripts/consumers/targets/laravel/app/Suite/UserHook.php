<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\Runtime\Denial;
use App\Generated\Tasks\Laravel\UserAuthenticateHook;
use App\Generated\Tasks\Laravel\UserCredentials;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;

/** The `user` identity's hook double: a bearer token of the credentials, or the same token as the session cookie. */
final class UserHook implements UserAuthenticateHook
{
    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:user', $request->operation()->api, $request->operation()->id);

        $credentials = $request->credentials();
        $token = $credentials instanceof UserCredentials ? ($credentials->bearer ?? $credentials->sessionCookie) : null;
        $userIds = [
            Credentials::text('userToken') => Credentials::text('userId'),
            Credentials::text('throttledUserToken') => Credentials::text('throttledUserId'),
        ];
        $userId = $token === null ? null : ($userIds[$token] ?? null);

        return $userId === null
            ? new AuthenticateResult\Denied(new Denial('api.unauthenticated'))
            : new AuthenticateResult\Authenticated(new UserPrincipal($userId));
    }
}
