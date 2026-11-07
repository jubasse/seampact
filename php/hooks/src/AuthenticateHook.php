<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/**
 * Authenticates the requests of one identity.
 *
 * @template TRequest of AuthenticateRequest
 */
interface AuthenticateHook
{
    /** @param TRequest $request */
    public function authenticate(AuthenticateRequest $request): AuthenticateResult;
}
