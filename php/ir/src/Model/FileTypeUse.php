<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
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
     * @param Docs|null $docs The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own.
     * @param list<mixed>|null $examples The examples written at the position of this use, placed as its docs are.
     */
    public function __construct(
        public array $media,
        public ?int $maxSizeBytes = null,
        public ?bool $nullable = null,
        public ?Docs $docs = null,
        public ?array $examples = null,
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
            docs: IrHydration::optional($members, 'docs', static fn (mixed $item): Docs => Docs::fromJson($item)),
            examples: IrHydration::optional($members, 'examples', static fn (mixed $item): array => IrHydration::listOf($item, 'FileTypeUse.examples', static fn (mixed $item): mixed => IrHydration::copy($item))),
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
        if ($this->docs !== null) {
            $json->{'docs'} = $this->docs->toJson();
        }
        if ($this->examples !== null) {
            $json->{'examples'} = IrHydration::encodeList($this->examples, static fn (mixed $item): mixed => IrHydration::copy($item));
        }
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
