<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class VocabularyEnumSource extends EnumSource
{
    /** The tag member 'kind': fixed to 'vocabulary'. */
    public string $kind;

    /**
     * @param string $vocabulary
     */
    public function __construct(
        public string $vocabulary,
    ) {
        $this->kind = 'vocabulary';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'VocabularyEnumSource');
        IrHydration::tag($members, 'kind', 'vocabulary', 'VocabularyEnumSource');

        return new self(
            vocabulary: IrHydration::string(IrHydration::required($members, 'vocabulary', 'VocabularyEnumSource'), 'VocabularyEnumSource.vocabulary'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'vocabulary'} = $this->vocabulary;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
