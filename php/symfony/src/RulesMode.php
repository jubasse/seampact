<?php

declare(strict_types=1);

namespace Seampact\Symfony;

/**
 * How the value rules render (ADR 0009 `rules`): Symfony's own constraints where it has one, or every rule generated
 * with ADR 0003's meaning.
 */
enum RulesMode: string
{
    case Native = 'native';
    case SeampactConsistent = 'seampact-consistent';
}
