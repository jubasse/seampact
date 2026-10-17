<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
final readonly class SignatureVerifyUnknown extends SignatureVerify
{
    public function __construct(
        public string $verify,
        public \stdClass $raw,
    ) {
        if (in_array($verify, ['template', 'application'], true)) {
            throw new IrModelException('SignatureVerifyUnknown: the verify is a known one');
        }
        if (($raw->{'verify'} ?? null) !== $verify) {
            throw new IrModelException('SignatureVerifyUnknown: raw does not carry the verify');
        }
    }

    public function tag(): string
    {
        return $this->verify;
    }

    public function toJson(): \stdClass
    {
        return $this->raw;
    }
}
