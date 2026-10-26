<?php

declare(strict_types=1);

namespace Seampact\Laravel;

/** Whose value rules a FormRequest uses: Laravel's own where it has one, or generated rules with the contract's meaning. */
enum RulesMode: string
{
    case Native = 'native';
    case SeampactConsistent = 'seampact-consistent';
}
