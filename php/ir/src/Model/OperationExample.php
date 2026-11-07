<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A route example; with 'error', 'value' holds the code's params. */
final readonly class OperationExample
{
    /**
     * @param mixed $value
     * @param int|null $status
     * @param bool|null $request
     * @param string|null $error
     */
    public function __construct(
        public mixed $value,
        public ?int $status = null,
        public ?bool $request = null,
        public ?string $error = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OperationExample');

        return new self(
            value: IrHydration::copy(IrHydration::required($members, 'value', 'OperationExample')),
            status: IrHydration::optional($members, 'status', static fn (mixed $item): int => IrHydration::integer($item, 'OperationExample.status')),
            request: IrHydration::optional($members, 'request', static fn (mixed $item): bool => IrHydration::boolean($item, 'OperationExample.request')),
            error: IrHydration::optional($members, 'error', static fn (mixed $item): string => IrHydration::string($item, 'OperationExample.error')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        if ($this->status !== null) {
            $json->{'status'} = $this->status;
        }
        if ($this->request !== null) {
            $json->{'request'} = $this->request;
        }
        if ($this->error !== null) {
            $json->{'error'} = $this->error;
        }
        $json->{'value'} = IrHydration::copy($this->value);
        return $json;
    }
}
