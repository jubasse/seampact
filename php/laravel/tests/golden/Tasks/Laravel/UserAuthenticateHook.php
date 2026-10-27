<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel;

use Seampact\Codegen\Runtime\AuthenticateCall;
use Seampact\Hooks\AuthenticateHook;

/**
 * Authenticates the requests of identity 'user'; bind it in the container.
 *
 * @extends AuthenticateHook<AuthenticateCall>
 */
interface UserAuthenticateHook extends AuthenticateHook
{
}
