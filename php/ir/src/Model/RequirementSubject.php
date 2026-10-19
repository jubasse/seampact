<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class RequirementSubject
{
    /**
     * @param ValueSource $source
     * @param bool $defaulted
     */
    public function __construct(
        public ValueSource $source,
        public bool $defaulted,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'RequirementSubject');

        return new self(
            source: ValueSource::fromJson(IrHydration::required($members, 'source', 'RequirementSubject')),
            defaulted: IrHydration::boolean(IrHydration::required($members, 'defaulted', 'RequirementSubject'), 'RequirementSubject.defaulted'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'source'} = $this->source->toJson();
        $json->{'defaulted'} = $this->defaulted;
        return $json;
    }
}
