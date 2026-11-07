<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** Whose value rules the generated validation uses (ADR 0009 `rules`): the framework's own where it has one, or generated rules with ADR 0003's meaning. */
enum RulesMode: string
{
    case Native = 'native';
    case SeampactConsistent = 'seampact-consistent';
}
