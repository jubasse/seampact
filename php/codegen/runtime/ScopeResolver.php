<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

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
