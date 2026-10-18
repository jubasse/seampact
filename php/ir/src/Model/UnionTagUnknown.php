<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
final readonly class UnionTagUnknown extends UnionTag
{
    private \stdClass $raw;

    public function __construct(
        public string $in,
        \stdClass $raw,
    ) {
        if (in_array($in, ['body', 'header'], true)) {
            throw new IrModelException('UnionTagUnknown: the in is a known one');
        }
        if (($raw->{'in'} ?? null) !== $in) {
            throw new IrModelException('UnionTagUnknown: raw does not carry the in');
        }
        $this->raw = IrHydration::copyObject($raw);
    }

    public function tag(): string
    {
        return $this->in;
    }

    /** A copy: the kept raw object cannot be changed through it. */
    public function raw(): \stdClass
    {
        return IrHydration::copyObject($this->raw);
    }

    public function toJson(): \stdClass
    {
        return IrHydration::copyObject($this->raw);
    }
}
