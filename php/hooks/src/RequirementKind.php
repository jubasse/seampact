<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** Whether a requirement is a right or a rule. */
enum RequirementKind: string
{
    case Right = 'right';
    case Rule = 'rule';
}
