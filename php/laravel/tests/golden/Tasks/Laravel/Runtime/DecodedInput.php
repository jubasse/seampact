<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/** The params step 1 decoded by the IR's wire form, by name; the body stays in the boundary state. */
final readonly class DecodedInput
{
    /**
     * @param array<string, mixed> $path
     * @param array<string, mixed> $query
     * @param array<string, mixed> $headers
     */
    public function __construct(public array $path, public array $query, public array $headers)
    {
    }
}
