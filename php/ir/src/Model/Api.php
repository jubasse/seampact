<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The api (ADR 0004 section 2). */
final readonly class Api
{
    private \stdClass $extensions;

    /**
     * @param string $id
     * @param Name $name
     * @param ApiVersion $version
     * @param ApiKind $kind
     * @param PathVersion $pathVersion
     * @param Maturity $maturity
     * @param Compat $compat
     * @param array<int|string, Surface> $surfaces
     * @param array<int|string, ApiDocument> $documents
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     * @param ApiRole|null $role
     * @param ApiCaller|null $caller
     */
    public function __construct(
        public string $id,
        public Name $name,
        public ApiVersion $version,
        public ApiKind $kind,
        public PathVersion $pathVersion,
        public Maturity $maturity,
        public Compat $compat,
        public array $surfaces,
        public array $documents,
        public Docs $docs,
        \stdClass $extensions,
        public Origin $origin,
        public ?ApiRole $role = null,
        public ?ApiCaller $caller = null,
    ) {
        $this->extensions = IrHydration::copyObject($extensions);
    }

    public function extensions(): \stdClass
    {
        return IrHydration::copyObject($this->extensions);
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Api');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'Api'), 'Api.id'),
            name: Name::fromJson(IrHydration::required($members, 'name', 'Api')),
            version: ApiVersion::fromJson(IrHydration::required($members, 'version', 'Api')),
            kind: ApiKind::fromJson(IrHydration::required($members, 'kind', 'Api')),
            pathVersion: PathVersion::fromJson(IrHydration::required($members, 'pathVersion', 'Api')),
            maturity: Maturity::fromJson(IrHydration::required($members, 'maturity', 'Api')),
            compat: Compat::fromJson(IrHydration::required($members, 'compat', 'Api')),
            surfaces: IrHydration::mapOf(IrHydration::required($members, 'surfaces', 'Api'), 'Api.surfaces', static fn (mixed $item): Surface => Surface::fromJson($item)),
            documents: IrHydration::mapOf(IrHydration::required($members, 'documents', 'Api'), 'Api.documents', static fn (mixed $item): ApiDocument => ApiDocument::fromJson($item)),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'Api')),
            extensions: IrHydration::copyObject(IrHydration::object(IrHydration::required($members, 'extensions', 'Api'), 'Api.extensions')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Api')),
            role: IrHydration::optional($members, 'role', static fn (mixed $item): ApiRole => ApiRole::fromJson($item)),
            caller: IrHydration::optional($members, 'caller', static fn (mixed $item): ApiCaller => ApiCaller::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'name'} = $this->name->toJson();
        $json->{'version'} = $this->version->toJson();
        $json->{'kind'} = $this->kind->toJson();
        $json->{'pathVersion'} = $this->pathVersion->toJson();
        if ($this->role !== null) {
            $json->{'role'} = $this->role->toJson();
        }
        $json->{'maturity'} = $this->maturity->toJson();
        if ($this->caller !== null) {
            $json->{'caller'} = $this->caller->toJson();
        }
        $json->{'compat'} = $this->compat->toJson();
        $json->{'surfaces'} = IrHydration::encodeMap($this->surfaces, static fn (Surface $item): mixed => $item->toJson());
        $json->{'documents'} = IrHydration::encodeMap($this->documents, static fn (ApiDocument $item): mixed => $item->toJson());
        $json->{'docs'} = $this->docs->toJson();
        $json->{'extensions'} = IrHydration::copy($this->extensions);
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
