<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\AccessUnknown;
use Seampact\Ir\Model\ArrayTypeUse;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\CredentialIdentity;
use Seampact\Ir\Model\Direction;
use Seampact\Ir\Model\Enum_;
use Seampact\Ir\Model\EnumTypeUse;
use Seampact\Ir\Model\ErrorDecl;
use Seampact\Ir\Model\FileTypeUse;
use Seampact\Ir\Model\IdentityAccess;
use Seampact\Ir\Model\InputMediaType;
use Seampact\Ir\Model\MapSchema;
use Seampact\Ir\Model\ObjectSchema;
use Seampact\Ir\Model\OpaqueTypeUse;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\OptionalAccess;
use Seampact\Ir\Model\Param;
use Seampact\Ir\Model\ProofPlacement;
use Seampact\Ir\Model\RefTypeUse;
use Seampact\Ir\Model\RequirementUnknown;
use Seampact\Ir\Model\RightRequirement;
use Seampact\Ir\Model\Response;
use Seampact\Ir\Model\ResponseShape;
use Seampact\Ir\Model\RuleRequirement;
use Seampact\Ir\Model\ScalarType;
use Seampact\Ir\Model\ScalarTypeUse;
use Seampact\Ir\Model\SchemaPrincipal;
use Seampact\Ir\Model\SignatureScheme;
use Seampact\Ir\Model\SignedIdentity;
use Seampact\Ir\Model\TemplateSignature;
use Seampact\Ir\Model\TypeUse;
use Seampact\Ir\Model\UnionSchema;
use Seampact\Ir\Model\UnknownKeysPolicy;
use Seampact\Ir\Model\UnknownQueryUnknown;
use Seampact\Ir\Model\UrlForm;
use Seampact\Ir\Model\ValueSchemeKey;
use Seampact\Ir\Model\ValueSourceIn;

/**
 * The forms a PHP target generates, read from the operations the entry keeps (ADR 0022 and 0023 "Refused by name or
 * waiting"): a form the target brings in a later release is refused with the arrival its `FormReleases` gives, a form
 * absent from the reference contract waits for a consumer after 1.0, and the schemas, enums and errors the kept
 * operations reach are collected. A form no kept operation carries is neither generated nor refused.
 */
final class KeptForms
{
    public const FORMAT_UUID = 'uuid';
    public const FORMAT_DATE_TIME = PhpTypes::DATE_TIME_FORMAT;
    private const SUPPORTED_FORMATS = [self::FORMAT_UUID, self::FORMAT_DATE_TIME];
    private const WIDE_FORMATS = ['int64', 'decimal'];
    private const JSON_MEDIA = 'application/json';
    private const PAGING_PARAMS_DERIVATION = 'paging.params';
    private const TOP_LEVEL_POINTER = '/^\/[^\/]+$/D';
    // The slots an item, table or list envelope may write that the boundary fills.
    private const PAYLOAD_SLOT = 'payload';
    private const ENVELOPE_SLOTS = [self::PAYLOAD_SLOT, 'status', 'path', 'meta'];
    private const BUCKET_KEY_SOURCES = [ValueSourceIn::Path, ValueSourceIn::Scope, ValueSourceIn::Principal];

    // Header params the boundary consumes itself: the credentials and the CSRF token never reach the handler.
    private const BOUNDARY_HEADER_DERIVATIONS = ['identity.authenticate', 'csrf.'];
    // The WHATWG URL path percent-encode set, byte by byte, and `\`, which a URL parser reads as `/`; a brace is a
    // placeholder's, refused in a mixed segment by the target.
    private const PERCENT_ENCODED_PATH_BYTES = '/[\x00-\x20"<>\x5E`\x5C\x7F-\xFF]/';

    /** @var list<array{int, Operation}> */
    private array $operations = [];

    /** @var array<string, ObjectSchema> */
    private array $objects = [];

    /** @var array<string, Enum_> */
    private array $enums = [];

    /** @var array<string, ErrorDecl> */
    private array $errors = [];

    /** @var array<string, true> */
    private array $identities = [];

    /** @var array<string, true> the formats already read */
    private array $formats = [];

    /** @var array<string, true> the success shapes already read, by format and shape */
    private array $formatShapes = [];

    public function __construct(private readonly ContractIR $ir, private readonly Refusals $refusals, private readonly FormReleases $releases)
    {
        if ($ir->api->wire->urls->value === UrlForm::Absolute) {
            $this->pending(PendingForm::AbsoluteUrls, 'urls.absolute', 'Absolute URLs (`api.wire.urls: absolute`)', IrPlace::root()->below('api', 'wire', 'urls'));
        }

        if ($ir->extensionKeys !== []) {
            $this->refusals->waiting('extensionKeys', 'Typed extension values', IrPlace::root()->below('extensionKeys'), Delivery::AfterOneZero);
        }

        foreach ($ir->operations as $index => $operation) {
            $this->operations[] = [$index, $operation];
            $this->readOperation($operation, IrPlace::ofOperation($index, $operation->id));
        }

        ksort($this->objects);
        ksort($this->enums);
        ksort($this->errors);
    }

    /** @return list<array{int, Operation}> each kept operation and its index in the IR */
    public function operations(): array
    {
        return $this->operations;
    }

    /** @return array<string, ObjectSchema> */
    public function objects(): array
    {
        return $this->objects;
    }

    /** @return array<string, Enum_> */
    public function enums(): array
    {
        return $this->enums;
    }

    /** @return array<string, ErrorDecl> */
    public function errors(): array
    {
        return $this->errors;
    }

    /**
     * The header params that reach the handler.
     *
     * @return list<Param>
     */
    public static function handlerHeaders(Operation $operation): array
    {
        return array_values(array_filter($operation->params->header, static function (Param $param): bool {
            $derivation = $param->derivedFrom->derivation ?? '';
            foreach (self::BOUNDARY_HEADER_DERIVATIONS as $consumed) {
                if ($derivation === $consumed || (str_ends_with($consumed, '.') && str_starts_with($derivation, $consumed))) {
                    return false;
                }
            }

            return true;
        }));
    }

    private function pending(PendingForm $form, string $code, string $description, IrPlace $at): void
    {
        $arrival = $this->releases->arrivalOf($form);

        if ($arrival !== null) {
            $this->refusals->pending($code, $description, $at, $arrival);
        }
    }

    private function readOperation(Operation $operation, IrPlace $at): void
    {
        if (!$operation->method->isKnown()) {
            $this->refusals->unknownValue($at->below('method'), $operation->method->value);
        }

        if ($operation->unknownQuery instanceof UnknownQueryUnknown) {
            $this->refusals->unknownValue($at->below('unknownQuery', 'policy'), $operation->unknownQuery->policy);
        }

        $this->readPath($operation, $at);
        $this->readAccess($operation, $at);
        $this->readFormat($operation->format);
        $this->readWaitingMembers($operation, $at);
        $this->readRequirements($operation, $at);
        $this->readAfterOneZeroMembers($operation, $at);

        foreach (['path' => $operation->params->path, 'query' => $operation->params->query, 'header' => self::handlerHeaders($operation)] as $part => $params) {
            foreach ($params as $paramIndex => $param) {
                $this->readParam($part, $param, $at->below('params', $part, $paramIndex));
            }
        }

        if ($operation->input !== null) {
            $this->readInput($operation, $at->below('input'));
        }

        foreach ($operation->responses as $responseIndex => $response) {
            $this->readResponse($response, $at->below('responses', $responseIndex));
            if ($response->body !== null) {
                $this->readSuccessShape($operation->format, $response->shape->value);
            }
        }

        foreach ($operation->errors as $errorIndex => $error) {
            $errorAt = $at->below('errors', $errorIndex);
            if ($error->retryHeader !== null) {
                $this->pending(PendingForm::RetryHeader, 'error.retryHeader', 'A retry header on an error', $errorAt->below('retryHeader'));
            }
            $this->readError($error->code, $errorAt);
        }
    }

    // Laravel's and Symfony's routers match the decoded path, which the boundary refuses for a percent-encoded static
    // segment (ADR 0023 and 0024 "Routes"), so such a route would answer 404 to every request.
    private function readPath(Operation $operation, IrPlace $at): void
    {
        foreach (explode('/', $operation->path) as $segment) {
            if (preg_match(RoutePlaceholder::PLACEHOLDER_SEGMENT, $segment) !== 1 && preg_match(self::PERCENT_ENCODED_PATH_BYTES, $segment) === 1) {
                $this->refusals->waiting('path.segment.encoded', "The static path segment '{$segment}', which a client sends percent-encoded,", $at->below('path'), Delivery::Consumer);
            }
        }
    }

    private function readAccess(Operation $operation, IrPlace $at): void
    {
        $access = $operation->access;

        if ($access instanceof AccessUnknown) {
            $this->refusals->unknownValue($at->below('access', 'kind'), $access->tag());

            return;
        }

        $identityId = match (true) {
            $access instanceof IdentityAccess, $access instanceof OptionalAccess => $access->identity,
            default => null,
        };

        if ($identityId !== null) {
            $this->readIdentity($identityId, $at->below('access'));
        }
    }

    private function readIdentity(string $identityId, IrPlace $at): void
    {
        $identity = $this->ir->identities[$identityId] ?? null;
        $identityAt = IrPlace::root()->below('identities', $identityId);

        if ($identity instanceof SignedIdentity) {
            $this->pending(PendingForm::SignedAccess, 'access.signed', "A route signed by identity '{$identityId}'", $at);
        }

        if (isset($this->identities[$identityId])) {
            return;
        }
        $this->identities[$identityId] = true;

        if ($identity === null) {
            $this->refusals->inconsistent('identity.undeclared', "The identity '{$identityId}' is not declared", $at->below('identity'));

            return;
        }

        if ($identity instanceof SignedIdentity) {
            $this->readSignatureScheme($identity->signed, $identityAt->below('signed'));
        } elseif (!$identity instanceof CredentialIdentity) {
            $this->refusals->unknownValue($identityAt->below('kind'), $identity->tag());

            return;
        }

        if (!$identity->principal instanceof SchemaPrincipal) {
            $this->refusals->waiting('principal.variants', 'A principal of several variants', $identityAt->below('principal'), Delivery::AfterOneZero);

            return;
        }

        $this->readPrincipalEnums($identity->principal->schema);
    }

    // The enums of the principal's members, which its generated principal class types them with.
    private function readPrincipalEnums(string $schemaId): void
    {
        $schema = $this->ir->schemas[$schemaId] ?? null;
        if (!$schema instanceof ObjectSchema) {
            return;
        }

        foreach ($schema->properties as $index => $property) {
            if ($property->type instanceof EnumTypeUse) {
                $this->readEnum($property->type, IrPlace::root()->below('schemas', $schemaId, 'properties', $index, 'type'));
            }
        }
    }

    // A success envelope the boundary renders around the payload (`{ data: $payload }`), as the Node targets render
    // it: with no format meta member, and per shape a response takes, no success header and no slot beside the
    // payload, the status and the path.
    private function readFormat(string $formatId): void
    {
        if (isset($this->formats[$formatId])) {
            return;
        }
        $this->formats[$formatId] = true;

        $format = $this->ir->formats[$formatId] ?? null;
        $formatAt = IrPlace::root()->below('formats', $formatId);
        if ($format === null) {
            $this->refusals->inconsistent('format.undeclared', "The format '{$formatId}' is not declared", $formatAt);

            return;
        }

        if ($format->meta !== []) {
            $this->refusals->waiting('format.meta', "The meta members of the format '{$formatId}'", $formatAt->below('meta'), Delivery::AfterOneZero);
        }
    }

    // The format's shape of a response with a body, read once per format and shape.
    private function readSuccessShape(string $formatId, string $shapeName): void
    {
        $format = $this->ir->formats[$formatId] ?? null;
        $shapes = $format === null ? [] : ['item' => $format->success->item, 'table' => $format->success->table, 'list' => $format->success->list, 'page' => $format->success->page];
        $shape = $shapes[$shapeName] ?? null;
        if ($shape === null || isset($this->formatShapes["{$formatId}/{$shapeName}"])) {
            return;
        }
        $this->formatShapes["{$formatId}/{$shapeName}"] = true;

        $shapeAt = IrPlace::root()->below('formats', $formatId, 'success', $shapeName);
        if ($shape->headers !== []) {
            $this->refusals->waiting('format.success.headers', 'A success format header', $shapeAt->below('headers'), Delivery::AfterOneZero);
        }
        if ($shapeName === 'page') {
            return;
        }

        $body = $shape->body->toJson();
        $payloadPath = self::slotPath($body, self::PAYLOAD_SLOT);
        if ($payloadPath === null) {
            $this->refusals->waiting('format.success.envelope', 'A success envelope that does not write `$payload` under named members', $shapeAt->below('body'), Delivery::AfterOneZero);

            return;
        }
        if ($payloadPath === []) {
            return;
        }

        foreach (self::templateSlots($body) as $slot) {
            if (!in_array($slot, self::ENVELOPE_SLOTS, true)) {
                $this->refusals->waiting('format.success.slot', "The success envelope slot '\${$slot}'", $shapeAt->below('body'), Delivery::AfterOneZero);
            }
        }
    }

    /** @return list<string>|null the member names down to the slot, reached through named object members only */
    private static function slotPath(mixed $template, string $slot): ?array
    {
        if (!$template instanceof \stdClass) {
            return null;
        }
        if (($template->kind ?? null) === 'slot') {
            return ($template->slot ?? null) === $slot && ($template->path ?? null) === [] ? [] : null;
        }
        if (($template->kind ?? null) !== 'object' || !is_array($template->members ?? null)) {
            return null;
        }

        foreach ($template->members as $member) {
            $name = $member instanceof \stdClass ? $member->name ?? null : null;
            if (!$name instanceof \stdClass || ($name->kind ?? null) !== 'text' || !is_string($name->text ?? null)) {
                continue;
            }
            $rest = self::slotPath($member->value ?? null, $slot);
            if ($rest !== null) {
                return [$name->text, ...$rest];
            }
        }

        return null;
    }

    /** @return list<string> the slot names a template writes, at any depth */
    private static function templateSlots(mixed $template): array
    {
        if ($template instanceof \stdClass) {
            $slot = ($template->kind ?? null) === 'slot' && is_string($template->slot ?? null) ? [$template->slot] : [];

            return [...$slot, ...self::templateSlots(get_object_vars($template))];
        }
        if (!is_array($template)) {
            return [];
        }

        $slots = [];
        foreach ($template as $value) {
            array_push($slots, ...self::templateSlots($value));
        }

        return $slots;
    }

    // A signed identity's scheme: verified by its template, with a key id the contract writes.
    private function readSignatureScheme(string $schemeId, IrPlace $at): void
    {
        $scheme = $this->ir->schemes[$schemeId] ?? null;
        if (!$scheme instanceof SignatureScheme) {
            $this->refusals->inconsistent('scheme.unresolved', "The signature scheme '{$schemeId}' is not declared", $at);

            return;
        }

        $schemeAt = IrPlace::root()->below('schemes', $schemeId);
        $signature = $scheme->signature;
        if (!$signature instanceof TemplateSignature) {
            $this->refusals->waiting('signature.application', 'A signature verified by the application', $schemeAt->below('signature'), Delivery::AfterOneZero);
        } elseif (!$signature->key instanceof ValueSchemeKey) {
            $this->refusals->waiting('signature.key.source', 'A signature key read from the request', $schemeAt->below('signature', 'key'), Delivery::AfterOneZero);
        }
    }

    private function readWaitingMembers(Operation $operation, IrPlace $at): void
    {
        $waiting = [
            [PendingForm::Paging, 'paging', $operation->paging, 'Paging', 'paging'],
            [PendingForm::Idempotency, 'idempotency', $operation->idempotency, 'Idempotency', 'idempotency'],
            [PendingForm::Cache, 'cache', $operation->cache, 'Cache and ETag headers', 'cache'],
            [PendingForm::Deadline, 'deadline', $operation->budgetMs ?? $operation->deadlineHeader, 'A deadline budget', $operation->budgetMs === null ? 'deadlineHeader' : 'budgetMs'],
            [PendingForm::Relays, 'relays', $operation->relays, 'A relayed operation', 'relays'],
        ];

        foreach ($waiting as [$form, $code, $value, $description, $member]) {
            if ($value !== null) {
                $this->pending($form, $code, $description, $at->below($member));
            }
        }
    }

    private function readRequirements(Operation $operation, IrPlace $at): void
    {
        foreach ($operation->requires as $index => $requirement) {
            $requirementAt = $at->below('requires', $index);

            if ($requirement instanceof RequirementUnknown) {
                $this->refusals->unknownValue($requirementAt->below('kind'), $requirement->tag());
                continue;
            }

            if ($requirement instanceof RightRequirement) {
                $this->pending(PendingForm::RightRequirement, 'requires.right', "The right '{$requirement->right}'", $requirementAt);
                continue;
            }

            if (!$requirement instanceof RuleRequirement) {
                continue;
            }

            if ($requirement->bucket !== null) {
                $this->pending(PendingForm::Throttle, 'throttle', "The rule '{$requirement->rule}', which throttles,", $requirementAt);
                $this->readBucket($requirement->bucket, $requirementAt->below('bucket'));
            } else {
                $this->pending(PendingForm::RuleRequirement, 'requires.rule', "The rule '{$requirement->rule}'", $requirementAt);
            }

            $proof = ($this->ir->rules[$requirement->rule] ?? null)?->proof;
            if ($proof !== null && $proof->in->value !== ProofPlacement::Body) {
                $this->refusals->waiting('rule.proof.placement', "A rule proof in '{$proof->in->value}'", IrPlace::root()->below('rules', $requirement->rule, 'proof', 'in'), Delivery::AfterOneZero);
            }
        }
    }

    // A throttle rule's bucket: its key reads the request's path, a resolved scope or the principal.
    private function readBucket(string $bucketId, IrPlace $at): void
    {
        $bucket = $this->ir->buckets[$bucketId] ?? null;
        if ($bucket === null) {
            $this->refusals->inconsistent('bucket.undeclared', "The bucket '{$bucketId}' is not declared", $at);

            return;
        }

        foreach ($bucket->key as $index => $source) {
            if (!in_array($source->in->value, self::BUCKET_KEY_SOURCES, true) || $source->name === null) {
                $this->refusals->waiting('bucket.key', "A bucket key read from '{$source->in->value}'", IrPlace::root()->below('buckets', $bucketId, 'key', $index), Delivery::AfterOneZero);
            }
        }
    }

    // Forms no boundary runtime of the reference contract runs, refused by name as on the Node and Spring targets.
    private function readAfterOneZeroMembers(Operation $operation, IrPlace $at): void
    {
        $members = [
            ['principalRequires', $operation->principalRequires, 'A principal requirement'],
            ['bindings', $operation->bindings, 'A principal binding'],
            ['upstream', $operation->upstream, 'An upstream service call'],
            ['features', $operation->features, 'An operation feature'],
        ];

        foreach ($members as [$member, $value, $description]) {
            if ($value !== []) {
                $this->refusals->waiting($member, $description, $at->below($member), Delivery::AfterOneZero);
            }
        }

        if ($operation->degradable !== null) {
            $this->refusals->waiting('degradable', 'A degradable operation', $at->below('degradable'), Delivery::AfterOneZero);
        }

        foreach ($operation->fieldRights as $index => $fieldRight) {
            if ($fieldRight->direction->value !== Direction::Output && preg_match(self::TOP_LEVEL_POINTER, $fieldRight->pointer) !== 1) {
                $this->refusals->waiting('fieldRight.nestedPointer', 'An input field right below the top level', $at->below('fieldRights', $index, 'pointer'), Delivery::AfterOneZero);
            }
        }

        foreach ($operation->scopes as $index => $scope) {
            if ($scope->source->in->value !== ValueSourceIn::Path) {
                $this->refusals->waiting('scope.source', "A scope id read from '{$scope->source->in->value}'", $at->below('scopes', $index, 'source'), Delivery::AfterOneZero);
            }
        }
    }

    private function readInput(Operation $operation, IrPlace $at): void
    {
        $input = $operation->input;
        if ($input === null) {
            return;
        }

        $media = $input->media->value;
        match (true) {
            $media === InputMediaType::MultipartFormData => $this->pending(PendingForm::Multipart, 'input.multipart', 'A multipart body', $at->below('media')),
            $media === InputMediaType::ApplicationXWwwFormUrlencoded => $this->refusals->waiting('input.form', 'A form body', $at->below('media'), Delivery::Consumer),
            $media !== InputMediaType::ApplicationJson => $this->refusals->unknownValue($at->below('media'), $media),
            default => null,
        };

        if ($input->rawBody) {
            $this->pending(PendingForm::RawBody, 'input.rawBody', 'A raw body kept for a signature', $at->below('rawBody'));
        }

        if (($input->fields ?? []) !== []) {
            $this->refusals->waiting('input.fields', 'Body fields beside the input schema', $at->below('fields'), Delivery::AfterOneZero);
        }

        foreach ($input->proofs ?? [] as $index => $proof) {
            $this->pending(PendingForm::Proofs, 'input.proofs', "The rule proof field '{$proof->name}' beside the input schema", $at->below('proofs', $index));
            $this->readType($proof->schema, $at->below('proofs', $index, 'schema'));
        }

        $this->readType($input->schema, $at->below('schema'));
    }

    private function readParam(string $part, Param $param, IrPlace $at): void
    {
        if ($param->default !== null) {
            $this->refusals->waiting('param.default', 'A parameter default', $at->below('default'), Delivery::AfterOneZero);
        }

        if ($param->type instanceof ScalarTypeUse || $param->type instanceof EnumTypeUse) {
            $this->readType($param->type, $at->below('type'));

            return;
        }

        $description = "A {$part} parameter that is not a scalar or an enum";
        if (($param->derivedFrom->derivation ?? null) === self::PAGING_PARAMS_DERIVATION) {
            $this->pending(PendingForm::PagingParam, "param.{$part}.structured", "{$description}, which paging reads,", $at->below('type'));
        } else {
            $this->refusals->waiting("param.{$part}.structured", $description, $at->below('type'), Delivery::Consumer);
        }
    }

    private function readResponse(Response $response, IrPlace $at): void
    {
        $shape = $response->shape->value;
        $shapeForm = match ($shape) {
            ResponseShape::Page => PendingForm::PageResponse,
            ResponseShape::List => PendingForm::ListResponse,
            ResponseShape::Binary => PendingForm::BinaryResponse,
            ResponseShape::Redirect => PendingForm::RedirectResponse,
            default => null,
        };

        if ($shapeForm !== null) {
            $this->pending($shapeForm, 'response.shape', "A '{$shape}' response", $at->below('shape'));
        } elseif (!in_array($shape, [ResponseShape::Item, ResponseShape::Table, ResponseShape::Empty], true)) {
            $this->refusals->unknownValue($at->below('shape'), $shape);
        }

        foreach ($response->headers as $index => $header) {
            $derivation = $header->derivedFrom->derivation ?? null;
            if ($derivation === null) {
                $this->refusals->waiting('response.header', "The response header '{$header->name}', written by the route,", $at->below('headers', $index), Delivery::AfterOneZero);
            } else {
                $this->pending(PendingForm::DerivedResponseHeader, 'response.header', "The response header '{$header->name}' of '{$derivation}'", $at->below('headers', $index));
            }
        }

        if ($response->body === null) {
            return;
        }

        if ($response->media !== self::JSON_MEDIA) {
            $this->refusals->waiting('response.media', "A '" . ($response->media ?? 'missing') . "' response body", $at->below('media'), Delivery::AfterOneZero);
        }

        $this->readType($response->body, $at->below('body'));
    }

    private function readError(string $code, IrPlace $at): void
    {
        if (isset($this->errors[$code])) {
            return;
        }

        $declared = $this->ir->errors[$code] ?? null;
        if ($declared === null) {
            $this->refusals->inconsistent('error.code.undeclared', "The error code '{$code}' is not in the errors registry", $at);

            return;
        }

        $this->errors[$code] = $declared;
        if ($declared->noStore === true) {
            $this->pending(PendingForm::ErrorNoStore, 'error.noStore', 'An error that forbids caching (noStore)', IrPlace::root()->below('errors', $code, 'noStore'));
        }
        if ($declared->params !== null) {
            $this->readType(new RefTypeUse($declared->params), IrPlace::root()->below('errors', $code, 'params'));
        }
    }

    private function readType(TypeUse $type, IrPlace $at): void
    {
        match (true) {
            $type instanceof ScalarTypeUse => $this->readScalar($type, $at),
            $type instanceof EnumTypeUse => $this->readEnum($type, $at),
            $type instanceof RefTypeUse => $this->readRef($type, $at),
            $type instanceof ArrayTypeUse => $this->readType($type->items, $at->below('items')),
            $type instanceof FileTypeUse => $this->pending(PendingForm::File, 'type.file', 'A file value', $at),
            $type instanceof OpaqueTypeUse => $this->pending(PendingForm::Opaque, 'type.opaque', 'An opaque value', $at),
            default => $this->refusals->unknownValue($at->below('kind'), $type->tag()),
        };
    }

    private function readScalar(ScalarTypeUse $type, IrPlace $at): void
    {
        if (!$type->type->isKnown()) {
            $this->refusals->unknownValue($at->below('type'), $type->type->value);
        }

        $format = $type->format;
        if (in_array($format, self::WIDE_FORMATS, true)) {
            $this->refusals->waiting('format.wide', "The format '{$format}'", $at->below('format'), Delivery::AfterOneZero);
        } elseif ($format !== null && (!in_array($format, self::SUPPORTED_FORMATS, true) || $type->type->value !== ScalarType::String)) {
            $this->refusals->waiting('format.string', "The format '{$format}'", $at->below('format'), Delivery::Consumer);
        }

        if ($type->content !== null) {
            $this->refusals->waiting('scalar.content', 'A JSON string content', $at->below('content'), Delivery::AfterOneZero);
        }

        if ($type->sensitive === true) {
            $this->pending(PendingForm::Sensitive, 'type.sensitive', 'A sensitive value, which needs redaction', $at);
        }
    }

    private function readEnum(EnumTypeUse $type, IrPlace $at): void
    {
        $enum = $this->ir->enums[$type->enum] ?? null;

        if ($enum === null) {
            $this->refusals->inconsistent('enum.undeclared', "The enum '{$type->enum}' is not declared", $at);

            return;
        }

        if ($enum->fallback !== null) {
            $this->refusals->waiting('enum.open', "The open enum '{$type->enum}'", IrPlace::root()->below('enums', $type->enum, 'fallback'), Delivery::AfterOneZero);
        }

        $this->enums[$type->enum] = $enum;
    }

    private function readRef(RefTypeUse $type, IrPlace $at): void
    {
        if ($type->unknownKeys?->policy->value === UnknownKeysPolicy::Keep) {
            $this->refusals->waiting('unknownKeys.keep', 'Unknown keys kept on a value', $at->below('unknownKeys'), Delivery::AfterOneZero);
        }

        $schema = $this->ir->schemas[$type->schema] ?? null;
        $schemaAt = IrPlace::root()->below('schemas', $type->schema);

        match (true) {
            $schema === null => $this->refusals->inconsistent('schema.undeclared', "The schema '{$type->schema}' is not declared", $at),
            $schema instanceof UnionSchema => $this->pending(PendingForm::Union, 'schema.union', 'A union', $schemaAt),
            $schema instanceof MapSchema => $this->refusals->waiting('schema.map', 'A map', $schemaAt, Delivery::AfterOneZero),
            $schema instanceof ObjectSchema => $this->readObject($type->schema, $schema, $schemaAt),
            default => $this->refusals->unknownValue($schemaAt->below('kind'), $schema->tag()),
        };
    }

    private function readObject(string $schemaId, ObjectSchema $schema, IrPlace $at): void
    {
        if (isset($this->objects[$schemaId])) {
            return;
        }

        $this->objects[$schemaId] = $schema;

        foreach ($schema->properties as $index => $property) {
            $propertyAt = $at->below('properties', $index);
            if ($property->sensitive) {
                $this->pending(PendingForm::Sensitive, 'type.sensitive', "The sensitive property '{$property->name}', which needs redaction", $propertyAt);
            }
            if ($property->default !== null) {
                $this->refusals->waiting('property.default', "The default of property '{$property->name}'", $propertyAt->below('default'), Delivery::AfterOneZero);
            }
            $this->readType($property->type, $propertyAt->below('type'));
        }
    }
}
