<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Where a value is read (ADR 0002 section 4); 'resolver' only as a scope source, 'holderField' only as a field right's subject source. Must act: an unknown value makes the IR invalid for every reader. */
final readonly class ValueSourceIn
{
    public const Path = 'path';
    public const Query = 'query';
    public const Header = 'header';
    public const Body = 'body';
    public const Principal = 'principal';
    public const Scope = 'scope';
    public const Host = 'host';
    public const Subdomain = 'subdomain';
    public const Address = 'address';
    public const Resolver = 'resolver';
    public const HolderField = 'holderField';

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
        return [self::Path, self::Query, self::Header, self::Body, self::Principal, self::Scope, self::Host, self::Subdomain, self::Address, self::Resolver, self::HolderField];
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
        return new self(IrHydration::string($value, 'ValueSourceIn'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
