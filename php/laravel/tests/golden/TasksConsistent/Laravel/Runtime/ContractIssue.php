<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

/** One contract issue a generated rule found: the request part, the JSON Pointer inside it and the contract rule. */
final readonly class ContractIssue
{
    public function __construct(public string $in, public string $pointer, public string $rule)
    {
    }
}
