<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/** A problem the reader reports at a key before the schema check; the schema errors at or under it would repeat it. */
final readonly class KeyProblem
{
    /** @param list<string|int> $path */
    public function __construct(public array $path, public ConfigProblem $problem)
    {
    }
}
