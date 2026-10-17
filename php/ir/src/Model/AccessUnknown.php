<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
final readonly class AccessUnknown extends Access
{
    public function __construct(
        public string $kind,
        public \stdClass $raw,
    ) {
        if (in_array($kind, ['identity', 'optional', 'public'], true)) {
            throw new IrModelException('AccessUnknown: the kind is a known one');
        }
        if (($raw->{'kind'} ?? null) !== $kind) {
            throw new IrModelException('AccessUnknown: raw does not carry the kind');
        }
    }

    public function tag(): string
    {
        return $this->kind;
    }

    public function toJson(): \stdClass
    {
        return $this->raw;
    }
}
