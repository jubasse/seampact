<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Cache settings (ADR 0004 section 7). */
final readonly class Cache
{
    /**
     * @param string $family
     * @param CacheVisibility $anonymous
     * @param list<string> $vary
     * @param bool $etag
     * @param list<CallerCacheControl> $perCallerKind
     * @param bool $noStore Authoritative: when true the response is never stored, whatever 'directives' hold. True when the family is 'never' or a response carries a sensitive field (ADR 0003 section 6).
     * @param Origin $origin
     * @param CacheDirectives|null $directives Absent if and only if the family is 'never' (invariant ir.cache.directives).
     * @param DerivedFrom|null $derivedFrom
     */
    public function __construct(
        public string $family,
        public CacheVisibility $anonymous,
        public array $vary,
        public bool $etag,
        public array $perCallerKind,
        public bool $noStore,
        public Origin $origin,
        public ?CacheDirectives $directives = null,
        public ?DerivedFrom $derivedFrom = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Cache');

        return new self(
            family: IrHydration::string(IrHydration::required($members, 'family', 'Cache'), 'Cache.family'),
            anonymous: CacheVisibility::fromJson(IrHydration::required($members, 'anonymous', 'Cache')),
            vary: IrHydration::listOf(IrHydration::required($members, 'vary', 'Cache'), 'Cache.vary', static fn (mixed $item): string => IrHydration::string($item, 'Cache.vary[]')),
            etag: IrHydration::boolean(IrHydration::required($members, 'etag', 'Cache'), 'Cache.etag'),
            perCallerKind: IrHydration::listOf(IrHydration::required($members, 'perCallerKind', 'Cache'), 'Cache.perCallerKind', static fn (mixed $item): CallerCacheControl => CallerCacheControl::fromJson($item)),
            noStore: IrHydration::boolean(IrHydration::required($members, 'noStore', 'Cache'), 'Cache.noStore'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Cache')),
            directives: IrHydration::optional($members, 'directives', static fn (mixed $item): CacheDirectives => CacheDirectives::fromJson($item)),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'family'} = $this->family;
        if ($this->directives !== null) {
            $json->{'directives'} = $this->directives->toJson();
        }
        $json->{'anonymous'} = $this->anonymous->toJson();
        $json->{'vary'} = $this->vary;
        $json->{'etag'} = $this->etag;
        $json->{'perCallerKind'} = IrHydration::encodeList($this->perCallerKind, static fn (CallerCacheControl $item): mixed => $item->toJson());
        $json->{'noStore'} = $this->noStore;
        $json->{'origin'} = $this->origin->toJson();
        if ($this->derivedFrom !== null) {
            $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        }
        return $json;
    }
}
