<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class TextTemplate extends Template
{
    /** The tag member 'kind': fixed to 'text'. */
    public string $kind;

    /**
     * @param list<TextPart> $parts
     */
    public function __construct(
        public array $parts,
    ) {
        $this->kind = 'text';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'TextTemplate');
        IrHydration::tag($members, 'kind', 'text', 'TextTemplate');

        return new self(
            parts: IrHydration::listOf(IrHydration::required($members, 'parts', 'TextTemplate'), 'TextTemplate.parts', static fn (mixed $item): TextPart => TextPart::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'parts'} = IrHydration::encodeList($this->parts, static fn (TextPart $item): mixed => $item->toJson());
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
