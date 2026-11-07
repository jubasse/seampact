<?php

declare(strict_types=1);

namespace Seampact\Hooks;

use Seampact\Hooks\ResolveScopeRequest\Extensions;

/** What the resolve-scope hook receives for one scope; the generated request class narrows each member. */
interface ResolveScopeRequest
{
    /** The scope's name. */
    public function scope(): string;

    /** Where the scope's id comes from. */
    public function source(): ScopeIdSource;

    /** Null for an anonymous caller on a public or optional-auth route. */
    public function principal(): ?object;

    /** @return list<ResolvedScope> the scopes already resolved, outermost first */
    public function outerScopes(): array;

    /** The extension values of the scope and of the operation. */
    public function extensions(): Extensions;
}
