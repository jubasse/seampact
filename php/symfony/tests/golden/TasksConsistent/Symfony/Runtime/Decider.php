<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

use Seampact\Hooks\DecideHook;

/**
 * A decide hook of the api, registered as the target's guide says (HookLookup::deciders()): it serves the rights and
 * rules `names()` lists, or every one the api declares with `EVERY_NAME`, which a decider naming one wins over.
 *
 * @extends DecideHook<RequirementCall>
 */
interface Decider extends DecideHook
{
    public const EVERY_NAME = '*';

    /** @return list<string> */
    public function names(): array;
}
