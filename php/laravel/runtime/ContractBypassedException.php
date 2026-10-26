<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

/**
 * A contract FormRequest ran for a request the boundary did not admit: an app route to the controller, a route
 * without the access middleware, or middleware turned off in a test. The reply is the api's 500.
 */
final class ContractBypassedException extends \LogicException
{
}
