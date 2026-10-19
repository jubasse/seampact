<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ApiCaller
{
    /**
     * @param string $identity
     * @param string $right
     */
    public function __construct(
        public string $identity,
        public string $right,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ApiCaller');

        return new self(
            identity: IrHydration::string(IrHydration::required($members, 'identity', 'ApiCaller'), 'ApiCaller.identity'),
            right: IrHydration::string(IrHydration::required($members, 'right', 'ApiCaller'), 'ApiCaller.right'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'identity'} = $this->identity;
        $json->{'right'} = $this->right;
        return $json;
    }
}
