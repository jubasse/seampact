<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel;

use Seampact\Golden\TasksConsistent\Laravel\Runtime\AuthenticateCall;
use Seampact\Hooks\AuthenticateHook;

/**
 * Authenticates the requests of identity 'user'; bind it in the container.
 *
 * @extends AuthenticateHook<AuthenticateCall>
 */
interface UserAuthenticateHook extends AuthenticateHook
{
}
