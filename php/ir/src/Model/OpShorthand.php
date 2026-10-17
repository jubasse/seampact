<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The ops shorthand an operation came from. */
final readonly class OpShorthand
{
    public const List = 'list';
    public const Get = 'get';
    public const Create = 'create';
    public const Update = 'update';
    public const Delete = 'delete';
    public const Batch = 'batch';

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
        return [self::List, self::Get, self::Create, self::Update, self::Delete, self::Batch];
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
        return new self(IrHydration::string($value, 'OpShorthand'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
