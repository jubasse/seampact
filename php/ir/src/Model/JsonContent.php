<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A form or multipart text field holding JSON. */
final readonly class JsonContent
{
    /**
     * @param JsonMediaType $media
     * @param TypeUse $schema
     */
    public function __construct(
        public JsonMediaType $media,
        public TypeUse $schema,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'JsonContent');

        return new self(
            media: JsonMediaType::fromJson(IrHydration::required($members, 'media', 'JsonContent')),
            schema: TypeUse::fromJson(IrHydration::required($members, 'schema', 'JsonContent')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'media'} = $this->media->toJson();
        $json->{'schema'} = $this->schema->toJson();
        return $json;
    }
}
