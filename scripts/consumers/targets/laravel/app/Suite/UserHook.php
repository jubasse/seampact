<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\Runtime\Denial;
use App\Generated\Tasks\Laravel\UserAuthenticateHook;
use App\Generated\Tasks\Laravel\UserCredentials;
use App\Generated\Tasks\Laravel\UserPrincipal;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Seampact\ConsumerSuite\Credentials;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;

/**
 * The `user` identity's hook double: a bearer token of the credentials, or the same token as the session cookie. The
 * token `GATE_DENIED_TOKEN` throws Laravel's `AuthorizationException`, as a `Gate::authorize()` in a hook would, and
 * `GUARD_DENIED_TOKEN` its `AuthenticationException`, as a guard's `authenticate()` would.
 */
final class UserHook implements UserAuthenticateHook
{
    public const GATE_DENIED_TOKEN = 'seampact-gate-denied';
    public const GUARD_DENIED_TOKEN = 'seampact-guard-denied';

    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:user', $request->operation()->api, $request->operation()->id);

        $credentials = $request->credentials();
        $token = $credentials instanceof UserCredentials ? ($credentials->bearer ?? $credentials->sessionCookie) : null;
        if ($token === self::GATE_DENIED_TOKEN) {
            throw new AuthorizationException('the gate denies this caller');
        }
        if ($token === self::GUARD_DENIED_TOKEN) {
            throw new AuthenticationException('the guard knows no such caller');
        }

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
