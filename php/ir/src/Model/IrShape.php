<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/**
 * The shape of the IR the reader walks on the raw JSON to find an unknown tag or value of a must-act definition
 * (ADR 0005 section 3): a definition by name, a struct's walked members, a tagged union, an open enum, an array
 * or a map. A member that holds no definition is not listed.
 */
final readonly class IrShape
{
    public const NAMED = 'named';
    public const STRUCT = 'struct';
    public const UNION = 'union';
    public const OPEN_ENUM = 'openEnum';
    public const ITEMS = 'items';
    public const VALUES = 'values';

    /**
     * @param array<string, IrShape> $members the walked members of a struct
     * @param array<string, string> $variants the definition of each tag value of a union
     * @param list<string> $known the known values of an open enum
     */
    private function __construct(
        public string $kind,
        public ?string $definition = null,
        public array $members = [],
        public ?string $tag = null,
        public bool $mustAct = false,
        public array $variants = [],
        public array $known = [],
        public ?IrShape $of = null,
    ) {
    }

    public static function named(string $definition): self
    {
        return new self(self::NAMED, definition: $definition);
    }

    /** @param array<string, IrShape> $members */
    public static function struct(array $members): self
    {
        return new self(self::STRUCT, members: $members);
    }

    /** @param array<string, string> $variants */
    public static function union(string $tag, bool $mustAct, array $variants): self
    {
        return new self(self::UNION, tag: $tag, mustAct: $mustAct, variants: $variants);
    }

    /** @param list<string> $known */
    public static function openEnum(array $known, bool $mustAct): self
    {
        return new self(self::OPEN_ENUM, mustAct: $mustAct, known: $known);
    }

    public static function items(IrShape $of): self
    {
        return new self(self::ITEMS, of: $of);
    }

    public static function values(IrShape $of): self
    {
        return new self(self::VALUES, of: $of);
    }
}
