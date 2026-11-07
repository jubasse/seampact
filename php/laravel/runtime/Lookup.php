<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

/**
 * What the input holds at a rule's attribute: a value, an absent key in an object that is there, or nothing to read
 * because a container above it is absent or of another type (the rule of that container reports it).
 */
final readonly class Lookup
{
    private const PRESENT = 'present';
    private const ABSENT = 'absent';
    private const UNREACHABLE = 'unreachable';

    private function __construct(private string $state, public mixed $value)
    {
    }

    public static function present(mixed $value): self
    {
        return new self(self::PRESENT, $value);
    }

    public static function absent(): self
    {
        return new self(self::ABSENT, null);
    }

    public static function unreachable(): self
    {
        return new self(self::UNREACHABLE, null);
    }

    public function isPresent(): bool
    {
        return $this->state === self::PRESENT;
    }

    public function isAbsent(): bool
    {
        return $this->state === self::ABSENT;
    }
}
