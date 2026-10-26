<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

/**
 * A contract handler was reached without the boundary's checks: no checked input is stored for its operation, as in
 * a sub-request from `forward()` or a test calling the method directly. The boundary answers it as the api's 500.
 */
final class BoundaryBypassedException extends \LogicException
{
}
