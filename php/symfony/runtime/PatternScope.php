<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

/**
 * Which strings a generated pattern or format check reads: every string, or only the empty string, which Symfony's
 * own `Regex`, `Uuid` and the like pass unchecked.
 */
enum PatternScope
{
    case EveryString;
    case EmptyStringOnly;
}
