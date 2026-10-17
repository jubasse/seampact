<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
final readonly class MemberNameUnknown extends MemberName
{
    public \stdClass $raw;

    public function __construct(
        public string $kind,
        \stdClass $raw,
    ) {
        if (in_array($kind, ['text', 'slot'], true)) {
            throw new IrModelException('MemberNameUnknown: the kind is a known one');
        }
        if (($raw->{'kind'} ?? null) !== $kind) {
            throw new IrModelException('MemberNameUnknown: raw does not carry the kind');
        }
        $this->raw = IrHydration::copyObject($raw);
    }

    public function tag(): string
    {
        return $this->kind;
    }

    public function toJson(): \stdClass
    {
        return IrHydration::copyObject($this->raw);
    }
}
