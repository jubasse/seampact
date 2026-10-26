<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

use Seampact\Hooks\ResolveScopeHook;

/**
 * The resolve-scope hook of one scope of the api, registered as the target's guide says (HookLookup::scopeResolvers()).
 *
 * @extends ResolveScopeHook<ScopeCall>
 */
interface ScopeResolver extends ResolveScopeHook
{
    public function scope(): string;
}
