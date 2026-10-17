<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A multipart field or a download (A39). */
final readonly class FileTypeUse extends TypeUse
{
    /** The tag member 'kind': fixed to 'file'. */
    public string $kind;

    /**
     * @param list<string> $media
     * @param int|null $maxSizeBytes
     * @param bool|null $nullable The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
     */
    public function __construct(
        public array $media,
        public ?int $maxSizeBytes = null,
        public ?bool $nullable = null,
    ) {
        $this->kind = 'file';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'FileTypeUse');
        IrHydration::tag($members, 'kind', 'file', 'FileTypeUse');

        return new self(
            media: IrHydration::listOf(IrHydration::required($members, 'media', 'FileTypeUse'), 'FileTypeUse.media', static fn (mixed $item): string => IrHydration::string($item, 'FileTypeUse.media[]')),
            maxSizeBytes: IrHydration::optional($members, 'maxSizeBytes', static fn (mixed $item): int => IrHydration::integer($item, 'FileTypeUse.maxSizeBytes')),
            nullable: IrHydration::optional($members, 'nullable', static fn (mixed $item): bool => IrHydration::boolean($item, 'FileTypeUse.nullable')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'media'} = $this->media;
        if ($this->maxSizeBytes !== null) {
            $json->{'maxSizeBytes'} = $this->maxSizeBytes;
        }
        if ($this->nullable !== null) {
            $json->{'nullable'} = $this->nullable;
        }
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
