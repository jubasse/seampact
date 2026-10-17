<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Where an extension key may appear (ADR 0002 section 12). */
final readonly class ExtensionPlace
{
    public const Api = 'api';
    public const Operation = 'operation';
    public const Schema = 'schema';
    public const Property = 'property';
    public const Right = 'right';
    public const Rule = 'rule';
    public const Scope = 'scope';

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
        return [self::Api, self::Operation, self::Schema, self::Property, self::Right, self::Rule, self::Scope];
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
        return new self(IrHydration::string($value, 'ExtensionPlace'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
