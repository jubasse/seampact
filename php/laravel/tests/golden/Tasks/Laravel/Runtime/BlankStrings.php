<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * Which strings a generated string rule checks: every string, or only the empty and whitespace-only ones, which
 * Laravel's own rules skip (`rules: native`).
 */
enum BlankStrings
{
    case Every;
    case BlankOnly;
}
