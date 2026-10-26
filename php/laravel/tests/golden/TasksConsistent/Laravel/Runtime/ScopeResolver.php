<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Seampact\Hooks\ResolveScopeHook;

/**
 * The resolve-scope hook of one scope of the api, tagged in the container with the provider's `SCOPE_RESOLVERS_TAG`.
 *
 * @extends ResolveScopeHook<ScopeCall>
 */
interface ScopeResolver extends ResolveScopeHook
{
    public function scope(): string;
}
