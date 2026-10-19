<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The HTTP attributes of an error code (ADR 0014). */
final readonly class ErrorHttp
{
    /**
     * @param int $status
     */
    public function __construct(
        public int $status,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ErrorHttp');

        return new self(
            status: IrHydration::integer(IrHydration::required($members, 'status', 'ErrorHttp'), 'ErrorHttp.status'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'status'} = $this->status;
        return $json;
    }
}
