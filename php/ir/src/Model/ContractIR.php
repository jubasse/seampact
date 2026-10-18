<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** One IR document per api (ADR 0004 sections 1 and 2). */
final readonly class ContractIR
{
    /**
     * @param int $irVersion 1 until 1.0 and through 1.x (ADR 0005 section 2).
     * @param int $irRevision Rises by one with every IR change (ADR 0005 section 2).
     * @param list<DeclarationKind> $kinds
     * @param list<string> $features
     * @param Api $api
     * @param list<PackRef> $packs
     * @param array<int|string, ConventionValue> $conventions
     * @param array<int|string, WireFormat> $formats
     * @param array<int|string, PagingStyle> $pagings
     * @param array<int|string, Schema> $schemas
     * @param array<int|string, Scalar> $scalars
     * @param array<int|string, Enum_> $enums
     * @param array<int|string, ErrorDecl> $errors
     * @param array<int|string, NatureDecl> $natures
     * @param array<int|string, Scheme> $schemes
     * @param array<int|string, HeaderDecl> $headers
     * @param array<int|string, Identity> $identities
     * @param array<int|string, Right> $rights
     * @param array<int|string, Rule> $rules
     * @param array<int|string, Scope> $scopes
     * @param array<int|string, Bucket> $buckets
     * @param array<int|string, Service> $services
     * @param array<int|string, ExtensionKeyDecl> $extensionKeys
     * @param Lint $lint
     * @param list<Operation> $operations
     */
    public function __construct(
        public int $irVersion,
        public int $irRevision,
        public array $kinds,
        public array $features,
        public Api $api,
        public array $packs,
        public array $conventions,
        public array $formats,
        public array $pagings,
        public array $schemas,
        public array $scalars,
        public array $enums,
        public array $errors,
        public array $natures,
        public array $schemes,
        public array $headers,
        public array $identities,
        public array $rights,
        public array $rules,
        public array $scopes,
        public array $buckets,
        public array $services,
        public array $extensionKeys,
        public Lint $lint,
        public array $operations,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ContractIR');

        return new self(
            irVersion: IrHydration::integer(IrHydration::required($members, 'irVersion', 'ContractIR'), 'ContractIR.irVersion'),
            irRevision: IrHydration::integer(IrHydration::required($members, 'irRevision', 'ContractIR'), 'ContractIR.irRevision'),
            kinds: IrHydration::listOf(IrHydration::required($members, 'kinds', 'ContractIR'), 'ContractIR.kinds', static fn (mixed $item): DeclarationKind => DeclarationKind::fromJson($item)),
            features: IrHydration::listOf(IrHydration::required($members, 'features', 'ContractIR'), 'ContractIR.features', static fn (mixed $item): string => IrHydration::string($item, 'ContractIR.features[]')),
            api: Api::fromJson(IrHydration::required($members, 'api', 'ContractIR')),
            packs: IrHydration::listOf(IrHydration::required($members, 'packs', 'ContractIR'), 'ContractIR.packs', static fn (mixed $item): PackRef => PackRef::fromJson($item)),
            conventions: IrHydration::mapOf(IrHydration::required($members, 'conventions', 'ContractIR'), 'ContractIR.conventions', static fn (mixed $item): ConventionValue => ConventionValue::fromJson($item)),
            formats: IrHydration::mapOf(IrHydration::required($members, 'formats', 'ContractIR'), 'ContractIR.formats', static fn (mixed $item): WireFormat => WireFormat::fromJson($item)),
            pagings: IrHydration::mapOf(IrHydration::required($members, 'pagings', 'ContractIR'), 'ContractIR.pagings', static fn (mixed $item): PagingStyle => PagingStyle::fromJson($item)),
            schemas: IrHydration::mapOf(IrHydration::required($members, 'schemas', 'ContractIR'), 'ContractIR.schemas', static fn (mixed $item): Schema => Schema::fromJson($item)),
            scalars: IrHydration::mapOf(IrHydration::required($members, 'scalars', 'ContractIR'), 'ContractIR.scalars', static fn (mixed $item): Scalar => Scalar::fromJson($item)),
            enums: IrHydration::mapOf(IrHydration::required($members, 'enums', 'ContractIR'), 'ContractIR.enums', static fn (mixed $item): Enum_ => Enum_::fromJson($item)),
            errors: IrHydration::mapOf(IrHydration::required($members, 'errors', 'ContractIR'), 'ContractIR.errors', static fn (mixed $item): ErrorDecl => ErrorDecl::fromJson($item)),
            natures: IrHydration::mapOf(IrHydration::required($members, 'natures', 'ContractIR'), 'ContractIR.natures', static fn (mixed $item): NatureDecl => NatureDecl::fromJson($item)),
            schemes: IrHydration::mapOf(IrHydration::required($members, 'schemes', 'ContractIR'), 'ContractIR.schemes', static fn (mixed $item): Scheme => Scheme::fromJson($item)),
            headers: IrHydration::mapOf(IrHydration::required($members, 'headers', 'ContractIR'), 'ContractIR.headers', static fn (mixed $item): HeaderDecl => HeaderDecl::fromJson($item)),
            identities: IrHydration::mapOf(IrHydration::required($members, 'identities', 'ContractIR'), 'ContractIR.identities', static fn (mixed $item): Identity => Identity::fromJson($item)),
            rights: IrHydration::mapOf(IrHydration::required($members, 'rights', 'ContractIR'), 'ContractIR.rights', static fn (mixed $item): Right => Right::fromJson($item)),
            rules: IrHydration::mapOf(IrHydration::required($members, 'rules', 'ContractIR'), 'ContractIR.rules', static fn (mixed $item): Rule => Rule::fromJson($item)),
            scopes: IrHydration::mapOf(IrHydration::required($members, 'scopes', 'ContractIR'), 'ContractIR.scopes', static fn (mixed $item): Scope => Scope::fromJson($item)),
            buckets: IrHydration::mapOf(IrHydration::required($members, 'buckets', 'ContractIR'), 'ContractIR.buckets', static fn (mixed $item): Bucket => Bucket::fromJson($item)),
            services: IrHydration::mapOf(IrHydration::required($members, 'services', 'ContractIR'), 'ContractIR.services', static fn (mixed $item): Service => Service::fromJson($item)),
            extensionKeys: IrHydration::mapOf(IrHydration::required($members, 'extensionKeys', 'ContractIR'), 'ContractIR.extensionKeys', static fn (mixed $item): ExtensionKeyDecl => ExtensionKeyDecl::fromJson($item)),
            lint: Lint::fromJson(IrHydration::required($members, 'lint', 'ContractIR')),
            operations: IrHydration::listOf(IrHydration::required($members, 'operations', 'ContractIR'), 'ContractIR.operations', static fn (mixed $item): Operation => Operation::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'irVersion'} = $this->irVersion;
        $json->{'irRevision'} = $this->irRevision;
        $json->{'kinds'} = IrHydration::encodeList($this->kinds, static fn (DeclarationKind $item): mixed => $item->toJson());
        $json->{'features'} = $this->features;
        $json->{'api'} = $this->api->toJson();
        $json->{'packs'} = IrHydration::encodeList($this->packs, static fn (PackRef $item): mixed => $item->toJson());
        $json->{'conventions'} = IrHydration::encodeMap($this->conventions, static fn (ConventionValue $item): mixed => $item->toJson());
        $json->{'formats'} = IrHydration::encodeMap($this->formats, static fn (WireFormat $item): mixed => $item->toJson());
        $json->{'pagings'} = IrHydration::encodeMap($this->pagings, static fn (PagingStyle $item): mixed => $item->toJson());
        $json->{'schemas'} = IrHydration::encodeMap($this->schemas, static fn (Schema $item): mixed => $item->toJson());
        $json->{'scalars'} = IrHydration::encodeMap($this->scalars, static fn (Scalar $item): mixed => $item->toJson());
        $json->{'enums'} = IrHydration::encodeMap($this->enums, static fn (Enum_ $item): mixed => $item->toJson());
        $json->{'errors'} = IrHydration::encodeMap($this->errors, static fn (ErrorDecl $item): mixed => $item->toJson());
        $json->{'natures'} = IrHydration::encodeMap($this->natures, static fn (NatureDecl $item): mixed => $item->toJson());
        $json->{'schemes'} = IrHydration::encodeMap($this->schemes, static fn (Scheme $item): mixed => $item->toJson());
        $json->{'headers'} = IrHydration::encodeMap($this->headers, static fn (HeaderDecl $item): mixed => $item->toJson());
        $json->{'identities'} = IrHydration::encodeMap($this->identities, static fn (Identity $item): mixed => $item->toJson());
        $json->{'rights'} = IrHydration::encodeMap($this->rights, static fn (Right $item): mixed => $item->toJson());
        $json->{'rules'} = IrHydration::encodeMap($this->rules, static fn (Rule $item): mixed => $item->toJson());
        $json->{'scopes'} = IrHydration::encodeMap($this->scopes, static fn (Scope $item): mixed => $item->toJson());
        $json->{'buckets'} = IrHydration::encodeMap($this->buckets, static fn (Bucket $item): mixed => $item->toJson());
        $json->{'services'} = IrHydration::encodeMap($this->services, static fn (Service $item): mixed => $item->toJson());
        $json->{'extensionKeys'} = IrHydration::encodeMap($this->extensionKeys, static fn (ExtensionKeyDecl $item): mixed => $item->toJson());
        $json->{'lint'} = $this->lint->toJson();
        $json->{'operations'} = IrHydration::encodeList($this->operations, static fn (Operation $item): mixed => $item->toJson());
        return $json;
    }
}
