<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

/** The bytes a bounded read held, or the role of the refusal it answers. */
final readonly class BodyRead
{
    private function __construct(public string $bytes, public ?string $refusedRole)
    {
    }

    public static function bytes(string $bytes): self
    {
        return new self($bytes, null);
    }

    public static function refused(string $role): self
    {
        return new self('', $role);
    }
}
