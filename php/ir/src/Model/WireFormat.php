<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A wire format (A30, ADR 0008). */
final readonly class WireFormat
{
    /**
     * @param string $id
     * @param Origin $origin
     * @param string $media
     * @param Absent $absent
     * @param SuccessShapes $success
     * @param array<int|string, MetaMember> $meta
     * @param ErrorShape $error
     */
    public function __construct(
        public string $id,
        public Origin $origin,
        public string $media,
        public Absent $absent,
        public SuccessShapes $success,
        public array $meta,
        public ErrorShape $error,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'WireFormat');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'WireFormat'), 'WireFormat.id'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'WireFormat')),
            media: IrHydration::string(IrHydration::required($members, 'media', 'WireFormat'), 'WireFormat.media'),
            absent: Absent::fromJson(IrHydration::required($members, 'absent', 'WireFormat')),
            success: SuccessShapes::fromJson(IrHydration::required($members, 'success', 'WireFormat')),
            meta: IrHydration::mapOf(IrHydration::required($members, 'meta', 'WireFormat'), 'WireFormat.meta', static fn (mixed $item): MetaMember => MetaMember::fromJson($item)),
            error: ErrorShape::fromJson(IrHydration::required($members, 'error', 'WireFormat')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'origin'} = $this->origin->toJson();
        $json->{'media'} = $this->media;
        $json->{'absent'} = $this->absent->toJson();
        $json->{'success'} = $this->success->toJson();
        $json->{'meta'} = IrHydration::encodeMap($this->meta, static fn (MetaMember $item): mixed => $item->toJson());
        $json->{'error'} = $this->error->toJson();
        return $json;
    }
}
