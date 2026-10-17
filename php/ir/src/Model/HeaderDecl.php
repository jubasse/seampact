<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** An identity header (ADR 0002 section 9). 'name' and 'in' for every semantic but versionToken; 'response' and 'request' for versionToken (invariant ir.header.members). */
final readonly class HeaderDecl
{
    /**
     * @param string $id
     * @param HeaderSemantic $semantic
     * @param Origin $origin
     * @param string|null $name
     * @param HeaderSide|null $in
     * @param string|null $response
     * @param string|null $request
     * @param TypeUse|null $schema
     */
    public function __construct(
        public string $id,
        public HeaderSemantic $semantic,
        public Origin $origin,
        public ?string $name = null,
        public ?HeaderSide $in = null,
        public ?string $response = null,
        public ?string $request = null,
        public ?TypeUse $schema = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'HeaderDecl');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'HeaderDecl'), 'HeaderDecl.id'),
            semantic: HeaderSemantic::fromJson(IrHydration::required($members, 'semantic', 'HeaderDecl')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'HeaderDecl')),
            name: IrHydration::optional($members, 'name', static fn (mixed $item): string => IrHydration::string($item, 'HeaderDecl.name')),
            in: IrHydration::optional($members, 'in', static fn (mixed $item): HeaderSide => HeaderSide::fromJson($item)),
            response: IrHydration::optional($members, 'response', static fn (mixed $item): string => IrHydration::string($item, 'HeaderDecl.response')),
            request: IrHydration::optional($members, 'request', static fn (mixed $item): string => IrHydration::string($item, 'HeaderDecl.request')),
            schema: IrHydration::optional($members, 'schema', static fn (mixed $item): TypeUse => TypeUse::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'semantic'} = $this->semantic->toJson();
        if ($this->name !== null) {
            $json->{'name'} = $this->name;
        }
        if ($this->in !== null) {
            $json->{'in'} = $this->in->toJson();
        }
        if ($this->response !== null) {
            $json->{'response'} = $this->response;
        }
        if ($this->request !== null) {
            $json->{'request'} = $this->request;
        }
        if ($this->schema !== null) {
            $json->{'schema'} = $this->schema->toJson();
        }
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
