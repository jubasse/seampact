<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\TasksPaging\Laravel\UserAuthenticateHook as PagingUserAuthenticateHook;
use App\Generated\TasksPaging\Laravel\UserCredentials as PagingUserCredentials;
use App\Generated\TasksPaging\Laravel\UserPrincipal as PagingUserPrincipal;
use App\Generated\TasksSplitSort\Laravel\UserAuthenticateHook as SplitSortUserAuthenticateHook;
use App\Generated\TasksSplitSort\Laravel\UserCredentials as SplitSortUserCredentials;
use App\Generated\TasksSplitSort\Laravel\UserPrincipal as SplitSortUserPrincipal;
use Seampact\Codegen\Runtime\Denial;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\ConsumerSuite\UserTokens;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;

/** The `user` identity's hook double of the `tasksPaging` and `tasksSplitSort` apis: a bearer token of the credentials. */
final class PagingUserHook implements PagingUserAuthenticateHook, SplitSortUserAuthenticateHook
{
    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        SuiteControl::recordHookCall('authenticate:user', $request->operation()->api, $request->operation()->id);
        SuiteControl::throwScriptedHookFailure('authenticate:user');

        $credentials = $request->credentials();
        $isUserCredentials = $credentials instanceof PagingUserCredentials || $credentials instanceof SplitSortUserCredentials;
        $userId = UserTokens::userIdOf($isUserCredentials ? ($credentials->bearer ?? $credentials->sessionCookie) : null);

        if ($userId === null) {
            return new AuthenticateResult\Denied(new Denial('api.unauthenticated'));
        }

        return new AuthenticateResult\Authenticated($credentials instanceof SplitSortUserCredentials ? new SplitSortUserPrincipal($userId) : new PagingUserPrincipal($userId));
    }
}
