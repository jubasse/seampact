<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Golden\Tasks\Symfony\Runtime\AuthenticateCall;
use Seampact\Hooks\AuthenticateHook;

/**
 * Authenticates the requests of identity 'user'; register one service implementing it, with autoconfiguration on.
 *
 * @extends AuthenticateHook<AuthenticateCall>
 */
interface UserAuthenticateHook extends AuthenticateHook
{
}
