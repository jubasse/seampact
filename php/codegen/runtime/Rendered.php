<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/** A rendered template value, or missing: a slot with no value renders as missing, never as `null`. */
final readonly class Rendered
{
    private function __construct(public bool $present, public mixed $value)
    {
    }

    public static function of(mixed $value): self
    {
        return new self(true, $value);
    }

    public static function missing(): self
    {
        return new self(false, null);
    }
}
