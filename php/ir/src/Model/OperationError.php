<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A code the operation can answer, declared or derived. */
final readonly class OperationError
{
    /**
     * @param string $code
     * @param IrOpaque|null $example
     * @param list<ErrorRoleBinding>|null $roles Sorted by role; absent when the code answers no role here.
     * @param RetryHeader|null $retryHeader
     * @param DerivedFrom|null $derivedFrom
     * @param Origin|null $origin
     */
    public function __construct(
        public string $code,
        public ?IrOpaque $example = null,
        public ?array $roles = null,
        public ?RetryHeader $retryHeader = null,
        public ?DerivedFrom $derivedFrom = null,
        public ?Origin $origin = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OperationError');

        return new self(
            code: IrHydration::string(IrHydration::required($members, 'code', 'OperationError'), 'OperationError.code'),
            example: IrHydration::optionalOpaque($members, 'example'),
            roles: IrHydration::optional($members, 'roles', static fn (mixed $item): array => IrHydration::listOf($item, 'OperationError.roles', static fn (mixed $item): ErrorRoleBinding => ErrorRoleBinding::fromJson($item))),
            retryHeader: IrHydration::optional($members, 'retryHeader', static fn (mixed $item): RetryHeader => RetryHeader::fromJson($item)),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
            origin: IrHydration::optional($members, 'origin', static fn (mixed $item): Origin => Origin::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'code'} = $this->code;
        if ($this->example !== null) {
            $json->{'example'} = IrHydration::copy($this->example->value());
        }
        if ($this->roles !== null) {
            $json->{'roles'} = IrHydration::encodeList($this->roles, static fn (ErrorRoleBinding $item): mixed => $item->toJson());
        }
        if ($this->retryHeader !== null) {
            $json->{'retryHeader'} = $this->retryHeader->toJson();
        }
        if ($this->derivedFrom !== null) {
            $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        }
        if ($this->origin !== null) {
            $json->{'origin'} = $this->origin->toJson();
        }
        return $json;
    }
}
