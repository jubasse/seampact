<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Ir\Model\AccessUnknown;
use Seampact\Ir\Model\ArrayTypeUse;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\EnumTypeUse;
use Seampact\Ir\Model\Enum_;
use Seampact\Ir\Model\ErrorDecl;
use Seampact\Ir\Model\FileTypeUse;
use Seampact\Ir\Model\HttpMethod;
use Seampact\Ir\Model\IdentityAccess;
use Seampact\Ir\Model\InputMediaType;
use Seampact\Ir\Model\MapSchema;
use Seampact\Ir\Model\ObjectSchema;
use Seampact\Ir\Model\OpaqueTypeUse;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\OptionalAccess;
use Seampact\Ir\Model\Param;
use Seampact\Ir\Model\RefTypeUse;
use Seampact\Ir\Model\Response;
use Seampact\Ir\Model\ResponseShape;
use Seampact\Ir\Model\ScalarType;
use Seampact\Ir\Model\ScalarTypeUse;
use Seampact\Ir\Model\SignedIdentity;
use Seampact\Ir\Model\TypeUse;
use Seampact\Ir\Model\UnionSchema;
use Seampact\Ir\Model\UnknownKeysPolicy;
use Seampact\Ir\Model\UrlForm;

/**
 * The forms this release generates, read from the operations the entry keeps: each form a later release or a consumer
 * brings is refused by name (ADR 0023 "Refused by name or waiting"), and the schemas, enums and errors the kept
 * operations reach are collected. A form no kept operation carries is neither generated nor refused.
 */
final class KeptForms
{
    public const FORMAT_UUID = 'uuid';
    public const FORMAT_DATE_TIME = 'date-time';
    private const SUPPORTED_FORMATS = [self::FORMAT_UUID, self::FORMAT_DATE_TIME];
    private const WIDE_FORMATS = ['int64', 'decimal'];
    private const JSON_MEDIA = 'application/json';
    private const SUPPORTED_SHAPES = [ResponseShape::Item, ResponseShape::Table, ResponseShape::Empty];
    private const LATER_SHAPES = [ResponseShape::Page, ResponseShape::Binary, ResponseShape::Redirect];

    // Header params the boundary consumes itself: the credentials and the CSRF token never reach the handler.
    private const BOUNDARY_HEADER_DERIVATIONS = ['identity.authenticate', 'csrf.'];

    /** @var list<array{int, Operation}> */
    public array $operations = [];

    /** @var array<string, ObjectSchema> */
    public array $objects = [];

    /** @var array<string, Enum_> */
    public array $enums = [];

    /** @var array<string, ErrorDecl> */
    public array $errors = [];

    public function __construct(private readonly ContractIR $ir, private readonly Refusals $refusals)
    {
        if ($ir->api->wire->urls->value === UrlForm::Absolute) {
            $refusals->waiting('urls.absolute', 'Absolute URLs (`api.wire.urls: absolute`)', IrPlace::root()->below('api', 'wire', 'urls'), Delivery::LaterRelease);
        }

        foreach ($ir->operations as $index => $operation) {
            $this->operations[] = [$index, $operation];
            $this->readOperation($operation, IrPlace::ofOperation($index, $operation->id));
        }

        ksort($this->objects);
        ksort($this->enums);
        ksort($this->errors);
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

    private function readOperation(Operation $operation, IrPlace $at): void
    {
        if (!$operation->method->isKnown()) {
            $this->refusals->unknownValue($at->below('method'), $operation->method->value);
        }

        $this->readAccess($operation, $at);
        $this->readWaitingMembers($operation, $at);

        foreach (['path' => $operation->params->path, 'query' => $operation->params->query, 'header' => self::handlerHeaders($operation)] as $part => $params) {
            foreach ($params as $paramIndex => $param) {
                $this->readParam($part, $param, $at->below('params', $part, $paramIndex));
            }
        }

        if ($operation->input !== null) {
            $inputAt = $at->below('input');
            $media = $operation->input->media->value;
            match (true) {
                $media === InputMediaType::MultipartFormData => $this->refusals->waiting('input.multipart', 'A multipart body', $inputAt->below('media'), Delivery::LaterRelease),
                $media === InputMediaType::ApplicationXWwwFormUrlencoded => $this->refusals->waiting('input.form', 'A form body', $inputAt->below('media'), Delivery::Consumer),
                $media !== InputMediaType::ApplicationJson => $this->refusals->unknownValue($inputAt->below('media'), $media),
                default => null,
            };
            if ($operation->input->rawBody) {
                $this->refusals->waiting('input.rawBody', 'A raw body kept for a signature', $inputAt->below('rawBody'), Delivery::LaterRelease);
            }
            if (($operation->input->fields ?? []) !== [] || ($operation->input->proofs ?? []) !== []) {
                $this->refusals->waiting('input.proofs', 'Body fields beside the input schema', $inputAt, Delivery::AfterOneZero);
            }
            $this->readType($operation->input->schema, $inputAt->below('schema'));
        }

        foreach ($operation->responses as $responseIndex => $response) {
            $this->readResponse($response, $at->below('responses', $responseIndex));
        }

        foreach ($operation->errors as $errorIndex => $error) {
            $errorAt = $at->below('errors', $errorIndex);
            if ($error->retryHeader !== null) {
                $this->refusals->waiting('error.retryHeader', 'A retry header on an error', $errorAt->below('retryHeader'), Delivery::LaterRelease);
            }
            $this->readError($error->code, $errorAt);
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

        if ($identityId !== null && ($this->ir->identities[$identityId] ?? null) instanceof SignedIdentity) {
            $this->refusals->waiting('access.signed', "A route signed by identity '{$identityId}'", $at->below('access'), Delivery::LaterRelease);
        }
    }

    private function readWaitingMembers(Operation $operation, IrPlace $at): void
    {
        $waiting = [
            ['paging', $operation->paging, 'Paging', Delivery::LaterRelease],
            ['idempotency', $operation->idempotency, 'Idempotency', Delivery::LaterRelease],
            ['cache', $operation->cache, 'Cache and ETag headers', Delivery::LaterRelease],
            ['deadline', $operation->budgetMs ?? $operation->deadlineHeader ?? $operation->degradable, 'A deadline budget', Delivery::LaterRelease],
            ['relays', $operation->relays, 'A relayed operation', Delivery::LaterRelease],
        ];

        foreach ($waiting as [$form, $value, $description, $delivery]) {
            if ($value !== null) {
                $this->refusals->waiting($form, $description, $at->below($form === 'deadline' ? 'budgetMs' : $form), $delivery);
            }
        }
    }

    private function readParam(string $part, Param $param, IrPlace $at): void
    {
        if ($param->default !== null) {
            $this->refusals->waiting('param.default', 'A parameter default', $at->below('default'), Delivery::AfterOneZero);
        }

        if (!$param->type instanceof ScalarTypeUse && !$param->type instanceof EnumTypeUse) {
            $this->refusals->waiting("param.{$part}.structured", "A {$part} parameter that is not a scalar or an enum", $at->below('type'), Delivery::Consumer);

            return;
        }

        $this->readType($param->type, $at->below('type'));
    }

    private function readResponse(Response $response, IrPlace $at): void
    {
        $shape = $response->shape->value;

        if (in_array($shape, self::LATER_SHAPES, true)) {
            $this->refusals->waiting('response.shape', "A '{$shape}' response", $at->below('shape'), Delivery::LaterRelease);
        } elseif (!in_array($shape, self::SUPPORTED_SHAPES, true)) {
            $this->refusals->unknownValue($at->below('shape'), $shape);
        }

        if ($response->headers !== []) {
            $this->refusals->waiting('response.header', "The response header '{$response->headers[0]->name}'", $at->below('headers', 0), Delivery::LaterRelease);
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
            $type instanceof FileTypeUse => $this->refusals->waiting('type.file', 'A file value', $at, Delivery::LaterRelease),
            $type instanceof OpaqueTypeUse => $this->refusals->waiting('type.opaque', 'An opaque value', $at, Delivery::AfterOneZero),
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
            $this->refusals->waiting('type.sensitive', 'A sensitive value, which needs redaction', $at, Delivery::LaterRelease);
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
            $schema instanceof UnionSchema => $this->refusals->waiting('schema.union', 'A union', $schemaAt, Delivery::AfterOneZero),
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
                $this->refusals->waiting('type.sensitive', "The sensitive property '{$property->name}', which needs redaction", $propertyAt, Delivery::LaterRelease);
            }
            if ($property->default !== null) {
                $this->refusals->waiting('property.default', "The default of property '{$property->name}'", $propertyAt->below('default'), Delivery::AfterOneZero);
            }
            $this->readType($property->type, $propertyAt->below('type'));
        }
    }
}
