<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

/** What the hook check warmer asks at warm-up: the input rules are checked at every level of the boot check. */
enum WarmerChecks
{
    case HooksAndInputRules;
    case InputRulesOnly;
}
