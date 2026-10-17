<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A scope (ADR 0004 section 4). */
final readonly class Scope
{
    private \stdClass $extensions;

    /**
     * @param string $id
     * @param TypeUse $idSchema
     * @param list<string> $errors
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     * @param string|null $within
     */
    public function __construct(
        public string $id,
        public TypeUse $idSchema,
        public array $errors,
        public Docs $docs,
        \stdClass $extensions,
        public Origin $origin,
        public ?string $within = null,
    ) {
        $this->extensions = IrHydration::copyObject($extensions);
    }

    public function extensions(): \stdClass
    {
        return IrHydration::copyObject($this->extensions);
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Scope');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'Scope'), 'Scope.id'),
            idSchema: TypeUse::fromJson(IrHydration::required($members, 'idSchema', 'Scope')),
            errors: IrHydration::listOf(IrHydration::required($members, 'errors', 'Scope'), 'Scope.errors', static fn (mixed $item): string => IrHydration::string($item, 'Scope.errors[]')),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'Scope')),
            extensions: IrHydration::copyObject(IrHydration::object(IrHydration::required($members, 'extensions', 'Scope'), 'Scope.extensions')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Scope')),
            within: IrHydration::optional($members, 'within', static fn (mixed $item): string => IrHydration::string($item, 'Scope.within')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'idSchema'} = $this->idSchema->toJson();
        if ($this->within !== null) {
            $json->{'within'} = $this->within;
        }
        $json->{'errors'} = $this->errors;
        $json->{'docs'} = $this->docs->toJson();
        $json->{'extensions'} = IrHydration::copy($this->extensions);
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
