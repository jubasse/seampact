<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A right (ADR 0004 section 4). */
final readonly class Right
{
    private \stdClass $extensions;

    /**
     * @param string $id
     * @param RightSubject $subject
     * @param list<string> $errors
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     * @param string|null $params
     * @param string|null $guest
     * @param DerivedFrom|null $derivedFrom
     * @param Name|null $codeName
     */
    public function __construct(
        public string $id,
        public RightSubject $subject,
        public array $errors,
        public Docs $docs,
        \stdClass $extensions,
        public Origin $origin,
        public ?string $params = null,
        public ?string $guest = null,
        public ?DerivedFrom $derivedFrom = null,
        public ?Name $codeName = null,
    ) {
        $this->extensions = IrHydration::copyObject($extensions);
    }

    public function extensions(): \stdClass
    {
        return IrHydration::copyObject($this->extensions);
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Right');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'Right'), 'Right.id'),
            subject: RightSubject::fromJson(IrHydration::required($members, 'subject', 'Right')),
            errors: IrHydration::listOf(IrHydration::required($members, 'errors', 'Right'), 'Right.errors', static fn (mixed $item): string => IrHydration::string($item, 'Right.errors[]')),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'Right')),
            extensions: IrHydration::copyObject(IrHydration::object(IrHydration::required($members, 'extensions', 'Right'), 'Right.extensions')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Right')),
            params: IrHydration::optional($members, 'params', static fn (mixed $item): string => IrHydration::string($item, 'Right.params')),
            guest: IrHydration::optional($members, 'guest', static fn (mixed $item): string => IrHydration::string($item, 'Right.guest')),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
            codeName: IrHydration::optional($members, 'codeName', static fn (mixed $item): Name => Name::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        if ($this->params !== null) {
            $json->{'params'} = $this->params;
        }
        $json->{'subject'} = $this->subject->toJson();
        if ($this->guest !== null) {
            $json->{'guest'} = $this->guest;
        }
        $json->{'errors'} = $this->errors;
        $json->{'docs'} = $this->docs->toJson();
        $json->{'extensions'} = IrHydration::copy($this->extensions);
        $json->{'origin'} = $this->origin->toJson();
        if ($this->derivedFrom !== null) {
            $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        }
        if ($this->codeName !== null) {
            $json->{'codeName'} = $this->codeName->toJson();
        }
        return $json;
    }
}
