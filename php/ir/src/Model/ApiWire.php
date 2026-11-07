<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The api-wide conventions a target acts on (ADR 0004 section 13). */
final readonly class ApiWire
{
    /**
     * @param Int64Wire $int64
     * @param OutputEnumForm $outputEnums
     * @param UrlForm $urls
     */
    public function __construct(
        public Int64Wire $int64,
        public OutputEnumForm $outputEnums,
        public UrlForm $urls,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ApiWire');

        return new self(
            int64: Int64Wire::fromJson(IrHydration::required($members, 'int64', 'ApiWire')),
            outputEnums: OutputEnumForm::fromJson(IrHydration::required($members, 'outputEnums', 'ApiWire')),
            urls: UrlForm::fromJson(IrHydration::required($members, 'urls', 'ApiWire')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'int64'} = $this->int64->toJson();
        $json->{'outputEnums'} = $this->outputEnums->toJson();
        $json->{'urls'} = $this->urls->toJson();
        return $json;
    }
}
