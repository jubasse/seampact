<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The role of a name (ADR 0007 section 1). */
final readonly class NameRole
{
    public const Schema = 'schema';
    public const Input = 'input';
    public const Output = 'output';
    public const Query = 'query';
    public const Headers = 'headers';
    public const Path = 'path';
    public const Response = 'response';
    public const Params = 'params';
    public const Error = 'error';
    public const Errors = 'errors';
    public const Property = 'property';
    public const Item = 'item';
    public const Value = 'value';
    public const Variant = 'variant';
    public const Endpoints = 'endpoints';
    public const Operation = 'operation';
    public const Member = 'member';
    public const EnumMember = 'enumMember';

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
        return [self::Schema, self::Input, self::Output, self::Query, self::Headers, self::Path, self::Response, self::Params, self::Error, self::Errors, self::Property, self::Item, self::Value, self::Variant, self::Endpoints, self::Operation, self::Member, self::EnumMember];
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
        return new self(IrHydration::string($value, 'NameRole'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
