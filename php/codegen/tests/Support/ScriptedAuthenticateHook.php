<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Codegen\Runtime\AuthenticateCall;
use Seampact\Hooks\AuthenticateHook;
use Seampact\Hooks\AuthenticateRequest;
use Seampact\Hooks\AuthenticateResult;

/**
 * An authenticate hook that runs the closure the test gives.
 *
 * @implements AuthenticateHook<AuthenticateCall>
 */
final readonly class ScriptedAuthenticateHook implements AuthenticateHook
{
    /** @param \Closure(AuthenticateCall): AuthenticateResult $script */
    public function __construct(private \Closure $script)
    {
    }

    public function authenticate(AuthenticateRequest $request): AuthenticateResult
    {
        return ($this->script)($request);
    }
}
