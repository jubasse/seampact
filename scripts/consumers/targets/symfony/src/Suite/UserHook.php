<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\InputRules\Symfony\UserAuthenticateHook as InputRulesUserAuthenticateHook;
use App\Generated\InputRules\Symfony\UserCredentials as InputRulesUserCredentials;
use App\Generated\InputRules\Symfony\UserPrincipal as InputRulesUserPrincipal;
use App\Generated\Tasks\Symfony\UserAuthenticateHook;
use App\Generated\Tasks\Symfony\UserCredentials;
use App\Generated\Tasks\Symfony\UserPrincipal;
use App\Generated\TasksAbsoluteUrls\Symfony\UserAuthenticateHook as AbsoluteUrlsUserAuthenticateHook;
use App\Generated\TasksAbsoluteUrls\Symfony\UserCredentials as AbsoluteUrlsUserCredentials;
use App\Generated\TasksAbsoluteUrls\Symfony\UserPrincipal as AbsoluteUrlsUserPrincipal;
use App\Generated\TasksOptionalAuth\Symfony\UserAuthenticateHook as OptionalAuthUserAuthenticateHook;
use App\Generated\TasksOptionalAuth\Symfony\UserCredentials as OptionalAuthUserCredentials;
use App\Generated\TasksOptionalAuth\Symfony\UserPrincipal as OptionalAuthUserPrincipal;
use App\Generated\TasksResponses\Symfony\UserAuthenticateHook as ResponsesUserAuthenticateHook;
use App\Generated\TasksResponses\Symfony\UserCredentials as ResponsesUserCredentials;
use App\Generated\TasksResponses\Symfony\UserPrincipal as ResponsesUserPrincipal;
use App\Kernel;
use Seampact\Codegen\Runtime\Denial;
use Seampact\ConsumerSuite\Credentials;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\ConsumerSuite\UserTokens;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;
use Symfony\Component\Security\Core\Exception\AuthenticationException;

/**
 * The `user` identity's hook double of the `tasks`, `tasksOptionalAuth`, `tasksAbsoluteUrls`, `tasksResponses` and
 * `inputRules` apis:
 * a bearer token of the credentials, or the same token as the session cookie. The token `GATE_DENIED_TOKEN` throws
 * Symfony's `AccessDeniedException`, as a `denyAccessUnlessGranted()` in a hook would, and `GUARD_DENIED_TOKEN` its
 * `AuthenticationException`, as an authenticator would. The token `FIREWALL_USER_TOKEN` reads the user the firewall
 * authenticated from the token storage, which the boundary's access steps run after.
 */
final class UserHook implements
    UserAuthenticateHook,
    OptionalAuthUserAuthenticateHook,
    AbsoluteUrlsUserAuthenticateHook,
    ResponsesUserAuthenticateHook,
    InputRulesUserAuthenticateHook
{
    public const FIREWALL_USER_TOKEN = 'seampact-firewall-user';
    public const GATE_DENIED_TOKEN = 'seampact-gate-denied';
    public const GUARD_DENIED_TOKEN = 'seampact-guard-denied';

    public function __construct(private readonly Security $security)
    {
    }

    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:user', $request->operation()->api, $request->operation()->id);
        SuiteControl::throwScriptedHookFailure('authenticate:user');

        $credentials = $request->credentials();
        $token = self::tokenOf($credentials);
        if ($token === self::GATE_DENIED_TOKEN) {
            throw new AccessDeniedException('the gate denies this caller');
        }
        if ($token === self::GUARD_DENIED_TOKEN) {
            throw new AuthenticationException('the guard knows no such caller');
        }

        $userId = $token === self::FIREWALL_USER_TOKEN ? $this->firewallUserId() : UserTokens::userIdOf($token);

        return $userId === null
            ? new AuthenticateResult\Denied(new Denial('api.unauthenticated'))
            : new AuthenticateResult\Authenticated(self::principalOf($credentials, $userId));
    }

    // The firewall's in-memory suite user is the credentials' user; anyone else, or no one, is unauthenticated.
    private function firewallUserId(): ?string
    {
        return $this->security->getUser()?->getUserIdentifier() === Kernel::SUITE_USER ? Credentials::text('userId') : null;
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
