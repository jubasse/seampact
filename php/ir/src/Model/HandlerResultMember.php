<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** What a handler returns beside a page's items. */
final readonly class HandlerResultMember
{
    public const NextCursor = 'nextCursor';
    public const PreviousCursor = 'previousCursor';
    public const Total = 'total';
    public const More = 'more';
    public const NextSince = 'nextSince';
    public const Complete = 'complete';

    private function __construct(public string $value)
    {
    }

    /**
     * The values this IR revision knows, in the schema's order.
     *
     * @return list<string>
     */
    public static function known(): array
    {
        return [self::NextCursor, self::PreviousCursor, self::Total, self::More, self::NextSince, self::Complete];
    }

    /** A value this IR revision does not know is kept; `isKnown()` tells it apart. */
    public static function of(string $value): self
    {
        return new self($value);
    }

    public function isKnown(): bool
    {
        return in_array($this->value, self::known(), true);
    }

    public static function fromJson(mixed $value): self
    {
        return new self(IrHydration::string($value, 'HandlerResultMember'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
