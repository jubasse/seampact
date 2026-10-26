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
     * @param list<string> $compilerWarnings the compiler binary's warnings on the documents, as it printed them
     */
    public function __construct(public array $lines, public array $warnings, public array $problems, public array $compilerWarnings = [])
    {
    }

    /** @param list<ConfigProblem> $problems */
    public static function refused(array $problems): self
    {
        return new self([], [], $problems);
    }
}
