<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Symfony\Component\Validator\Constraint;

/** The tasks api's input rules of one operation and part, with the constraints the test gives. */
final class ScriptedInputRules implements TasksInputRules
{
    /** @param Constraint|array<Constraint> $constraints */
    public function __construct(private readonly string $operationId, private readonly string $part, private readonly Constraint|array $constraints)
    {
    }

    public function operationId(): string
    {
        return $this->operationId;
    }

    public function part(): string
    {
        return $this->part;
    }

    public function constraints(): Constraint|array
    {
        return $this->constraints;
    }
}
