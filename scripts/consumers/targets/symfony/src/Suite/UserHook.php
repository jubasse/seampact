<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Symfony\Runtime\Denial;
use App\Generated\Tasks\Symfony\UserAuthenticateHook;
use App\Generated\Tasks\Symfony\UserCredentials;
use App\Generated\Tasks\Symfony\UserPrincipal;
use App\Kernel;
use Seampact\ConsumerSuite\Credentials;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\Security\Core\Exception\AccessDeniedException;
use Symfony\Component\Security\Core\Exception\AuthenticationException;

/**
 * The `user` identity's hook double: a bearer token of the credentials, or the same token as the session cookie. The
 * token `GATE_DENIED_TOKEN` throws Symfony's `AccessDeniedException`, as a `denyAccessUnlessGranted()` in a hook would, and
 * `GUARD_DENIED_TOKEN` its `AuthenticationException`, as an authenticator would. The token `FIREWALL_USER_TOKEN` reads
 * the user the firewall authenticated from the token storage, which the boundary's access steps run after.
 */
final class UserHook implements UserAuthenticateHook
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

        $credentials = $request->credentials();
        $token = $credentials instanceof UserCredentials ? ($credentials->bearer ?? $credentials->sessionCookie) : null;
        if ($token === self::GATE_DENIED_TOKEN) {
            throw new AccessDeniedException('the gate denies this caller');
        }
        if ($token === self::GUARD_DENIED_TOKEN) {
            throw new AuthenticationException('the guard knows no such caller');
        }
        if ($token === self::FIREWALL_USER_TOKEN) {
            return $this->firewallUser();
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

    // The firewall's in-memory suite user is the credentials' user; anyone else, or no one, is unauthenticated.
    private function firewallUser(): AuthenticateResult
    {
        return $this->security->getUser()?->getUserIdentifier() === Kernel::SUITE_USER
            ? new AuthenticateResult\Authenticated(new UserPrincipal(Credentials::text('userId')))
            : new AuthenticateResult\Denied(new Denial('api.unauthenticated'));
    }
}
