<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/**
 * A hook lookup that also knows whether the app runs in its framework's debug mode (Laravel `app.debug`, Symfony
 * `kernel.debug`). In debug only, an exception no role maps on a contract route goes to the framework's own error
 * page, and the boundary's log line names its message and `file:line`; outside debug the api's 500 is unchanged.
 */
interface DebugLookup
{
    public function isDebug(): bool;
}
