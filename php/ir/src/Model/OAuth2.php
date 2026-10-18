<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The OAuth 2 facts of a bearer scheme, for documents only. */
final readonly class OAuth2
{
    /**
     * @param mixed $flows OpenAPI OAuth flows, copied as written.
     */
    public function __construct(
        public mixed $flows,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OAuth2');

        return new self(
            flows: IrHydration::copy(IrHydration::required($members, 'flows', 'OAuth2')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'flows'} = IrHydration::copy($this->flows);
        return $json;
    }
}
