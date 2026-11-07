<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The format shape of a response; 'binary' and 'redirect' bypass the format (ADR 0004 section 8). */
final readonly class ResponseShape
{
    public const Item = 'item';
    public const Table = 'table';
    public const List = 'list';
    public const Page = 'page';
    public const Empty = 'empty';
    public const Binary = 'binary';
    public const Redirect = 'redirect';

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
        return [self::Item, self::Table, self::List, self::Page, self::Empty, self::Binary, self::Redirect];
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
        return new self(IrHydration::string($value, 'ResponseShape'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
