<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** How a query value is written (FR-30). */
final readonly class QueryWireKind
{
    public const Number = 'number';
    public const Boolean = 'boolean';
    public const List = 'list';
    public const Text = 'text';
    public const Object = 'object';

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
        return [self::Number, self::Boolean, self::List, self::Text, self::Object];
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
        return new self(IrHydration::string($value, 'QueryWireKind'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
