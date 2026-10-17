<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ObjectTemplate extends Template
{
    /** The tag member 'kind': fixed to 'object'. */
    public string $kind;

    /**
     * @param list<ObjectTemplateMember> $members
     * @param string|null $merge
     */
    public function __construct(
        public array $members,
        public ?string $merge = null,
    ) {
        $this->kind = 'object';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ObjectTemplate');
        IrHydration::tag($members, 'kind', 'object', 'ObjectTemplate');

        return new self(
            members: IrHydration::listOf(IrHydration::required($members, 'members', 'ObjectTemplate'), 'ObjectTemplate.members', static fn (mixed $item): ObjectTemplateMember => ObjectTemplateMember::fromJson($item)),
            merge: IrHydration::optional($members, 'merge', static fn (mixed $item): string => IrHydration::string($item, 'ObjectTemplate.merge')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'members'} = IrHydration::encodeList($this->members, static fn (ObjectTemplateMember $item): mixed => $item->toJson());
        if ($this->merge !== null) {
            $json->{'merge'} = $this->merge;
        }
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
