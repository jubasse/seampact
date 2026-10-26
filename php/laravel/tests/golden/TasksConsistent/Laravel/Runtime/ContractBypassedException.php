<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

/**
 * A contract step ran for a request the boundary did not admit: an app route to the controller, a route the
 * boundary's access step did not run on, or the boundary turned off in a test. The reply is the api's 500.
 */
final class ContractBypassedException extends \LogicException
{
}
