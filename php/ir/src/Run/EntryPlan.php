<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Write\PlannedWrite;
use Seampact\Ir\Write\WriterRefusal;

/**
 * One entry's plan: the writer's plan of its files, or why it does not generate. `writerRefusals` are the writer's
 * own (a check reads hand edits among them as drift); `problems` are every other refusal.
 */
final readonly class EntryPlan
{
    /**
     * @param list<WriterRefusal> $writerRefusals
     * @param list<ConfigProblem> $problems
     */
    public function __construct(public string $entryId, public ?PlannedWrite $write, public array $writerRefusals, public array $problems)
    {
    }

    /** @return list<ConfigProblem> */
    public function allProblems(): array
    {
        $where = "entry '{$this->entryId}'";

        return [...$this->problems, ...array_map(static fn (WriterRefusal $refusal): ConfigProblem => RunProblems::ofWriter($refusal, $where), $this->writerRefusals)];
    }
}
