<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\ConfigProblem;

/** What a run did: the lines it prints, the warnings, and the problems that fail it; no problem passes. */
final readonly class RunReport
{
    /**
     * @param list<string> $lines
     * @param list<ConfigProblem> $warnings
     * @param list<ConfigProblem> $problems
     */
    public function __construct(public array $lines, public array $warnings, public array $problems)
    {
    }

    /** @param list<ConfigProblem> $problems */
    public static function refused(array $problems): self
    {
        return new self([], [], $problems);
    }
}
