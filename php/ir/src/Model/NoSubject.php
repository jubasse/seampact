<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class NoSubject extends RightSubject
{
    /** The tag member 'kind': fixed to 'none'. */
    public string $kind;

    public function __construct(
    ) {
        $this->kind = 'none';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'NoSubject');
        IrHydration::tag($members, 'kind', 'none', 'NoSubject');

        return new self(
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
