<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Codegen\Runtime\AuthenticateCall;
use Seampact\Hooks\AuthenticateHook;

/**
 * Authenticates the requests of identity 'user'; register one service implementing it, with autoconfiguration on.
 *
 * @extends AuthenticateHook<AuthenticateCall>
 */
interface UserAuthenticateHook extends AuthenticateHook
{
}
