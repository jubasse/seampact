<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\ConfigProblem;

/** A generator refuses what it reads (a contract form, an option), each refusal named with its code and fix. */
final class GenerationRefusedException extends \RuntimeException
{
    /** @param list<ConfigProblem> $problems */
    public function __construct(public readonly array $problems)
    {
        parent::__construct(ConfigProblem::text($problems));
    }
}
