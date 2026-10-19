<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** An HTTP operation (ADR 0004 section 7). */
final readonly class Operation
{
    private \stdClass $extensions;

    /**
     * @param DeclarationKind $kind
     * @param string $id
     * @param Name $name
     * @param string $surface
     * @param list<string> $features
     * @param HttpMethod $method
     * @param string $path
     * @param bool $safe
     * @param Params $params
     * @param UnknownQuery $unknownQuery
     * @param Access $access
     * @param list<CallerKind> $callerKinds
     * @param list<PrincipalRequirement> $principalRequires
     * @param list<OperationScope> $scopes
     * @param list<Requirement> $requires
     * @param list<Binding> $bindings
     * @param list<Response> $responses
     * @param list<OperationError> $errors
     * @param list<FieldRight> $fieldRights
     * @param list<string> $upstream
     * @param OperationMaturity $maturity
     * @param bool $internal
     * @param string $format
     * @param list<string> $tags
     * @param array<int|string, OperationExample> $examples
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     * @param OpShorthand|null $op
     * @param OperationResource|null $resource
     * @param OperationInput|null $input
     * @param Idempotency|null $idempotency
     * @param Concurrency|null $concurrency
     * @param Owner|null $owner
     * @param Cache|null $cache
     * @param Paging|null $paging
     * @param string|null $filteredBy
     * @param Degradable|null $degradable
     * @param int|null $budgetMs
     * @param string|null $deadlineHeader
     * @param Deprecation|null $deprecated
     * @param OperationRef|null $relays
     * @param Csrf|null $csrf
     */
    public function __construct(
        public DeclarationKind $kind,
        public string $id,
        public Name $name,
        public string $surface,
        public array $features,
        public HttpMethod $method,
        public string $path,
        public bool $safe,
        public Params $params,
        public UnknownQuery $unknownQuery,
        public Access $access,
        public array $callerKinds,
        public array $principalRequires,
        public array $scopes,
        public array $requires,
        public array $bindings,
        public array $responses,
        public array $errors,
        public array $fieldRights,
        public array $upstream,
        public OperationMaturity $maturity,
        public bool $internal,
        public string $format,
        public array $tags,
        public array $examples,
        public Docs $docs,
        \stdClass $extensions,
        public Origin $origin,
        public ?OpShorthand $op = null,
        public ?OperationResource $resource = null,
        public ?OperationInput $input = null,
        public ?Idempotency $idempotency = null,
        public ?Concurrency $concurrency = null,
        public ?Owner $owner = null,
        public ?Cache $cache = null,
        public ?Paging $paging = null,
        public ?string $filteredBy = null,
        public ?Degradable $degradable = null,
        public ?int $budgetMs = null,
        public ?string $deadlineHeader = null,
        public ?Deprecation $deprecated = null,
        public ?OperationRef $relays = null,
        public ?Csrf $csrf = null,
    ) {
        $this->extensions = IrHydration::copyObject($extensions);
    }

    public function extensions(): \stdClass
    {
        return IrHydration::copyObject($this->extensions);
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Operation');

        return new self(
            kind: DeclarationKind::fromJson(IrHydration::required($members, 'kind', 'Operation')),
            id: IrHydration::string(IrHydration::required($members, 'id', 'Operation'), 'Operation.id'),
            name: Name::fromJson(IrHydration::required($members, 'name', 'Operation')),
            surface: IrHydration::string(IrHydration::required($members, 'surface', 'Operation'), 'Operation.surface'),
            features: IrHydration::listOf(IrHydration::required($members, 'features', 'Operation'), 'Operation.features', static fn (mixed $item): string => IrHydration::string($item, 'Operation.features[]')),
            method: HttpMethod::fromJson(IrHydration::required($members, 'method', 'Operation')),
            path: IrHydration::string(IrHydration::required($members, 'path', 'Operation'), 'Operation.path'),
            safe: IrHydration::boolean(IrHydration::required($members, 'safe', 'Operation'), 'Operation.safe'),
            params: Params::fromJson(IrHydration::required($members, 'params', 'Operation')),
            unknownQuery: UnknownQuery::fromJson(IrHydration::required($members, 'unknownQuery', 'Operation')),
            access: Access::fromJson(IrHydration::required($members, 'access', 'Operation')),
            callerKinds: IrHydration::listOf(IrHydration::required($members, 'callerKinds', 'Operation'), 'Operation.callerKinds', static fn (mixed $item): CallerKind => CallerKind::fromJson($item)),
            principalRequires: IrHydration::listOf(IrHydration::required($members, 'principalRequires', 'Operation'), 'Operation.principalRequires', static fn (mixed $item): PrincipalRequirement => PrincipalRequirement::fromJson($item)),
            scopes: IrHydration::listOf(IrHydration::required($members, 'scopes', 'Operation'), 'Operation.scopes', static fn (mixed $item): OperationScope => OperationScope::fromJson($item)),
            requires: IrHydration::listOf(IrHydration::required($members, 'requires', 'Operation'), 'Operation.requires', static fn (mixed $item): Requirement => Requirement::fromJson($item)),
            bindings: IrHydration::listOf(IrHydration::required($members, 'bindings', 'Operation'), 'Operation.bindings', static fn (mixed $item): Binding => Binding::fromJson($item)),
            responses: IrHydration::listOf(IrHydration::required($members, 'responses', 'Operation'), 'Operation.responses', static fn (mixed $item): Response => Response::fromJson($item)),
            errors: IrHydration::listOf(IrHydration::required($members, 'errors', 'Operation'), 'Operation.errors', static fn (mixed $item): OperationError => OperationError::fromJson($item)),
            fieldRights: IrHydration::listOf(IrHydration::required($members, 'fieldRights', 'Operation'), 'Operation.fieldRights', static fn (mixed $item): FieldRight => FieldRight::fromJson($item)),
            upstream: IrHydration::listOf(IrHydration::required($members, 'upstream', 'Operation'), 'Operation.upstream', static fn (mixed $item): string => IrHydration::string($item, 'Operation.upstream[]')),
            maturity: OperationMaturity::fromJson(IrHydration::required($members, 'maturity', 'Operation')),
            internal: IrHydration::boolean(IrHydration::required($members, 'internal', 'Operation'), 'Operation.internal'),
            format: IrHydration::string(IrHydration::required($members, 'format', 'Operation'), 'Operation.format'),
            tags: IrHydration::listOf(IrHydration::required($members, 'tags', 'Operation'), 'Operation.tags', static fn (mixed $item): string => IrHydration::string($item, 'Operation.tags[]')),
            examples: IrHydration::mapOf(IrHydration::required($members, 'examples', 'Operation'), 'Operation.examples', static fn (mixed $item): OperationExample => OperationExample::fromJson($item)),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'Operation')),
            extensions: IrHydration::copyObject(IrHydration::object(IrHydration::required($members, 'extensions', 'Operation'), 'Operation.extensions')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Operation')),
            op: IrHydration::optional($members, 'op', static fn (mixed $item): OpShorthand => OpShorthand::fromJson($item)),
            resource: IrHydration::optional($members, 'resource', static fn (mixed $item): OperationResource => OperationResource::fromJson($item)),
            input: IrHydration::optional($members, 'input', static fn (mixed $item): OperationInput => OperationInput::fromJson($item)),
            idempotency: IrHydration::optional($members, 'idempotency', static fn (mixed $item): Idempotency => Idempotency::fromJson($item)),
            concurrency: IrHydration::optional($members, 'concurrency', static fn (mixed $item): Concurrency => Concurrency::fromJson($item)),
            owner: IrHydration::optional($members, 'owner', static fn (mixed $item): Owner => Owner::fromJson($item)),
            cache: IrHydration::optional($members, 'cache', static fn (mixed $item): Cache => Cache::fromJson($item)),
            paging: IrHydration::optional($members, 'paging', static fn (mixed $item): Paging => Paging::fromJson($item)),
            filteredBy: IrHydration::optional($members, 'filteredBy', static fn (mixed $item): string => IrHydration::string($item, 'Operation.filteredBy')),
            degradable: IrHydration::optional($members, 'degradable', static fn (mixed $item): Degradable => Degradable::fromJson($item)),
            budgetMs: IrHydration::optional($members, 'budgetMs', static fn (mixed $item): int => IrHydration::integer($item, 'Operation.budgetMs')),
            deadlineHeader: IrHydration::optional($members, 'deadlineHeader', static fn (mixed $item): string => IrHydration::string($item, 'Operation.deadlineHeader')),
            deprecated: IrHydration::optional($members, 'deprecated', static fn (mixed $item): Deprecation => Deprecation::fromJson($item)),
            relays: IrHydration::optional($members, 'relays', static fn (mixed $item): OperationRef => OperationRef::fromJson($item)),
            csrf: IrHydration::optional($members, 'csrf', static fn (mixed $item): Csrf => Csrf::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind->toJson();
        $json->{'id'} = $this->id;
        $json->{'name'} = $this->name->toJson();
        $json->{'surface'} = $this->surface;
        if ($this->op !== null) {
            $json->{'op'} = $this->op->toJson();
        }
        if ($this->resource !== null) {
            $json->{'resource'} = $this->resource->toJson();
        }
        $json->{'features'} = $this->features;
        $json->{'method'} = $this->method->toJson();
        $json->{'path'} = $this->path;
        $json->{'safe'} = $this->safe;
        $json->{'params'} = $this->params->toJson();
        $json->{'unknownQuery'} = $this->unknownQuery->toJson();
        $json->{'access'} = $this->access->toJson();
        $json->{'callerKinds'} = IrHydration::encodeList($this->callerKinds, static fn (CallerKind $item): mixed => $item->toJson());
        $json->{'principalRequires'} = IrHydration::encodeList($this->principalRequires, static fn (PrincipalRequirement $item): mixed => $item->toJson());
        $json->{'scopes'} = IrHydration::encodeList($this->scopes, static fn (OperationScope $item): mixed => $item->toJson());
        $json->{'requires'} = IrHydration::encodeList($this->requires, static fn (Requirement $item): mixed => $item->toJson());
        $json->{'bindings'} = IrHydration::encodeList($this->bindings, static fn (Binding $item): mixed => $item->toJson());
        if ($this->input !== null) {
            $json->{'input'} = $this->input->toJson();
        }
        $json->{'responses'} = IrHydration::encodeList($this->responses, static fn (Response $item): mixed => $item->toJson());
        $json->{'errors'} = IrHydration::encodeList($this->errors, static fn (OperationError $item): mixed => $item->toJson());
        $json->{'fieldRights'} = IrHydration::encodeList($this->fieldRights, static fn (FieldRight $item): mixed => $item->toJson());
        if ($this->idempotency !== null) {
            $json->{'idempotency'} = $this->idempotency->toJson();
        }
        if ($this->concurrency !== null) {
            $json->{'concurrency'} = $this->concurrency->toJson();
        }
        if ($this->owner !== null) {
            $json->{'owner'} = $this->owner->toJson();
        }
        if ($this->cache !== null) {
            $json->{'cache'} = $this->cache->toJson();
        }
        if ($this->paging !== null) {
            $json->{'paging'} = $this->paging->toJson();
        }
        if ($this->filteredBy !== null) {
            $json->{'filteredBy'} = $this->filteredBy;
        }
        if ($this->degradable !== null) {
            $json->{'degradable'} = $this->degradable->toJson();
        }
        if ($this->budgetMs !== null) {
            $json->{'budgetMs'} = $this->budgetMs;
        }
        if ($this->deadlineHeader !== null) {
            $json->{'deadlineHeader'} = $this->deadlineHeader;
        }
        if ($this->deprecated !== null) {
            $json->{'deprecated'} = $this->deprecated->toJson();
        }
        if ($this->relays !== null) {
            $json->{'relays'} = $this->relays->toJson();
        }
        $json->{'upstream'} = $this->upstream;
        $json->{'maturity'} = $this->maturity->toJson();
        $json->{'internal'} = $this->internal;
        if ($this->csrf !== null) {
            $json->{'csrf'} = $this->csrf->toJson();
        }
        $json->{'format'} = $this->format;
        $json->{'tags'} = $this->tags;
        $json->{'examples'} = IrHydration::encodeMap($this->examples, static fn (OperationExample $item): mixed => $item->toJson());
        $json->{'docs'} = $this->docs->toJson();
        $json->{'extensions'} = IrHydration::copy($this->extensions);
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
