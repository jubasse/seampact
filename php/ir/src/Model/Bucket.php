<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A rate-limit bucket (ADR 0004 section 4). */
final readonly class Bucket
{
    /**
     * @param string $id
     * @param list<ValueSource> $key
     * @param Origin $origin
     * @param int|null $limit
     * @param int|null $windowMs
     */
    public function __construct(
        public string $id,
        public array $key,
        public Origin $origin,
        public ?int $limit = null,
        public ?int $windowMs = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Bucket');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'Bucket'), 'Bucket.id'),
            key: IrHydration::listOf(IrHydration::required($members, 'key', 'Bucket'), 'Bucket.key', static fn (mixed $item): ValueSource => ValueSource::fromJson($item)),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Bucket')),
            limit: IrHydration::optional($members, 'limit', static fn (mixed $item): int => IrHydration::integer($item, 'Bucket.limit')),
            windowMs: IrHydration::optional($members, 'windowMs', static fn (mixed $item): int => IrHydration::integer($item, 'Bucket.windowMs')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'key'} = IrHydration::encodeList($this->key, static fn (ValueSource $item): mixed => $item->toJson());
        if ($this->limit !== null) {
            $json->{'limit'} = $this->limit;
        }
        if ($this->windowMs !== null) {
            $json->{'windowMs'} = $this->windowMs;
        }
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
