<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\UserAuthenticateHook;
use App\Generated\Tasks\Laravel\UserCredentials;
use App\Generated\Tasks\Laravel\UserPrincipal;
use App\Generated\InputRules\Laravel\UserAuthenticateHook as InputRulesUserAuthenticateHook;
use App\Generated\InputRules\Laravel\UserCredentials as InputRulesUserCredentials;
use App\Generated\InputRules\Laravel\UserPrincipal as InputRulesUserPrincipal;
use App\Generated\TasksAbsoluteUrls\Laravel\UserAuthenticateHook as AbsoluteUrlsUserAuthenticateHook;
use App\Generated\TasksAbsoluteUrls\Laravel\UserCredentials as AbsoluteUrlsUserCredentials;
use App\Generated\TasksAbsoluteUrls\Laravel\UserPrincipal as AbsoluteUrlsUserPrincipal;
use App\Generated\TasksOptionalAuth\Laravel\UserAuthenticateHook as OptionalAuthUserAuthenticateHook;
use App\Generated\TasksOptionalAuth\Laravel\UserCredentials as OptionalAuthUserCredentials;
use App\Generated\TasksOptionalAuth\Laravel\UserPrincipal as OptionalAuthUserPrincipal;
use App\Generated\TasksResponses\Laravel\UserAuthenticateHook as ResponsesUserAuthenticateHook;
use App\Generated\TasksResponses\Laravel\UserCredentials as ResponsesUserCredentials;
use App\Generated\TasksResponses\Laravel\UserPrincipal as ResponsesUserPrincipal;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Seampact\Codegen\Runtime\Denial;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\ConsumerSuite\UserTokens;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;

/**
 * The `user` identity's hook double of the `tasks`, `tasksOptionalAuth`, `tasksAbsoluteUrls`, `tasksResponses` and
 * `inputRules` apis:
 * a bearer token of the credentials, or the same token as the session cookie. The token `GATE_DENIED_TOKEN` throws
 * Laravel's `AuthorizationException`, as a `Gate::authorize()` in a hook would, and `GUARD_DENIED_TOKEN` its
 * `AuthenticationException`, as a guard's `authenticate()` would.
 */
final class UserHook implements
    UserAuthenticateHook,
    OptionalAuthUserAuthenticateHook,
    AbsoluteUrlsUserAuthenticateHook,
    ResponsesUserAuthenticateHook,
    InputRulesUserAuthenticateHook
{
    public const GATE_DENIED_TOKEN = 'seampact-gate-denied';
    public const GUARD_DENIED_TOKEN = 'seampact-guard-denied';

    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:user', $request->operation()->api, $request->operation()->id);
        SuiteControl::throwScriptedHookFailure('authenticate:user');

        $credentials = $request->credentials();
        $token = self::tokenOf($credentials);
        if ($token === self::GATE_DENIED_TOKEN) {
            throw new AuthorizationException('the gate denies this caller');
        }
        if ($token === self::GUARD_DENIED_TOKEN) {
            throw new AuthenticationException('the guard knows no such caller');
        }

        $userId = UserTokens::userIdOf($token);

        return $userId === null
            ? new AuthenticateResult\Denied(new Denial('api.unauthenticated'))
            : new AuthenticateResult\Authenticated(self::principalOf($credentials, $userId));
    }

    private static function tokenOf(object $credentials): ?string
    {
        $isUserCredentials = $credentials instanceof UserCredentials
            || $credentials instanceof OptionalAuthUserCredentials
            || $credentials instanceof AbsoluteUrlsUserCredentials
            || $credentials instanceof ResponsesUserCredentials
            || $credentials instanceof InputRulesUserCredentials;

        return $isUserCredentials ? ($credentials->bearer ?? $credentials->sessionCookie) : null;
    }

    /** The principal of the api whose credentials the request presents. */
    private static function principalOf(object $credentials, string $userId): object
    {
        return match (true) {
            $credentials instanceof OptionalAuthUserCredentials => new OptionalAuthUserPrincipal($userId),
            $credentials instanceof AbsoluteUrlsUserCredentials => new AbsoluteUrlsUserPrincipal($userId),
            $credentials instanceof ResponsesUserCredentials => new ResponsesUserPrincipal($userId),
            $credentials instanceof InputRulesUserCredentials => new InputRulesUserPrincipal($userId),
            default => new UserPrincipal($userId),
        };
    }
}
