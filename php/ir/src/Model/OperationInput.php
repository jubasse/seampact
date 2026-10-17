<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The request body. */
final readonly class OperationInput
{
    /**
     * @param InputMediaType $media
     * @param TypeUse $schema
     * @param int $bodyLimitBytes
     * @param bool $rawBody
     * @param Origin $origin
     * @param list<InputField>|null $fields
     * @param list<InputProof>|null $proofs The body fields of the rule proofs read in the body, each once, in requirement order; absent when there is none. Targets render the body as the input schema's properties followed by these fields.
     */
    public function __construct(
        public InputMediaType $media,
        public TypeUse $schema,
        public int $bodyLimitBytes,
        public bool $rawBody,
        public Origin $origin,
        public ?array $fields = null,
        public ?array $proofs = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OperationInput');

        return new self(
            media: InputMediaType::fromJson(IrHydration::required($members, 'media', 'OperationInput')),
            schema: TypeUse::fromJson(IrHydration::required($members, 'schema', 'OperationInput')),
            bodyLimitBytes: IrHydration::integer(IrHydration::required($members, 'bodyLimitBytes', 'OperationInput'), 'OperationInput.bodyLimitBytes'),
            rawBody: IrHydration::boolean(IrHydration::required($members, 'rawBody', 'OperationInput'), 'OperationInput.rawBody'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'OperationInput')),
            fields: IrHydration::optional($members, 'fields', static fn (mixed $item): array => IrHydration::listOf($item, 'OperationInput.fields', static fn (mixed $item): InputField => InputField::fromJson($item))),
            proofs: IrHydration::optional($members, 'proofs', static fn (mixed $item): array => IrHydration::listOf($item, 'OperationInput.proofs', static fn (mixed $item): InputProof => InputProof::fromJson($item))),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'media'} = $this->media->toJson();
        $json->{'schema'} = $this->schema->toJson();
        $json->{'bodyLimitBytes'} = $this->bodyLimitBytes;
        $json->{'rawBody'} = $this->rawBody;
        if ($this->fields !== null) {
            $json->{'fields'} = IrHydration::encodeList($this->fields, static fn (InputField $item): mixed => $item->toJson());
        }
        if ($this->proofs !== null) {
            $json->{'proofs'} = IrHydration::encodeList($this->proofs, static fn (InputProof $item): mixed => $item->toJson());
        }
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
