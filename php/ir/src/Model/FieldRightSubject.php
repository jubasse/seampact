<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class FieldRightSubject
{
    /**
     * @param ValueSource $source Where the subject is read; 'in: holderField' names the holder's property on output.
     */
    public function __construct(
        public ValueSource $source,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'FieldRightSubject');

        return new self(
            source: ValueSource::fromJson(IrHydration::required($members, 'source', 'FieldRightSubject')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'source'} = $this->source->toJson();
        return $json;
    }
}
