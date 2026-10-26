<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Run\GenerationRefusedException;

/** Why the generator writes no file for one entry, each reason with its code, fix and JSON Pointer; one per place. */
final class GenerationProblems
{
    /** @var array<string, ConfigProblem> */
    private array $problems = [];

    public function __construct(private readonly string $entryId)
    {
    }

    public function add(string $code, string $message, string $fix, string $pointer, ?string $operationId = null): void
    {
        $where = "entry '{$this->entryId}' " . ($pointer === '' ? '/' : $pointer)
            . ($operationId === null ? '' : " (operation '{$operationId}')");

        $this->problems[$code . "\0" . $where] ??= new ConfigProblem($code, $message, $fix, $where);
    }

    /** @throws GenerationRefusedException when a problem was added */
    public function throwIfAny(): void
    {
        if ($this->problems !== []) {
            throw new GenerationRefusedException(array_values($this->problems));
        }
    }
}
