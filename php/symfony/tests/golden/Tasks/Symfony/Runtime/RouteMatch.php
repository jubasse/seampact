<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

/**
 * What the raw request target matched: an operation with its raw path parameters, or, for a path under one of the
 * api's base paths that no contract route serves with this method, no operation (the api's `notFound`).
 */
final readonly class RouteMatch
{
    /** @param array<string, string> $rawParameters */
    private function __construct(public ?string $operationId, public array $rawParameters)
    {
    }

    /** @param array<string, string> $rawParameters */
    public static function operation(string $operationId, array $rawParameters): self
    {
        return new self($operationId, $rawParameters);
    }

    public static function unserved(): self
    {
        return new self(null, []);
    }
}
