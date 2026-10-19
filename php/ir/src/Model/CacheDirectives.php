<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class CacheDirectives
{
    /**
     * @param int $maxAgeMs
     * @param bool $immutable
     * @param bool $noCache
     * @param bool $mustRevalidate
     * @param int|null $sharedMaxAgeMs
     * @param int|null $staleWhileRevalidateMs
     * @param int|null $staleIfErrorMs
     */
    public function __construct(
        public int $maxAgeMs,
        public bool $immutable,
        public bool $noCache,
        public bool $mustRevalidate,
        public ?int $sharedMaxAgeMs = null,
        public ?int $staleWhileRevalidateMs = null,
        public ?int $staleIfErrorMs = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'CacheDirectives');

        return new self(
            maxAgeMs: IrHydration::integer(IrHydration::required($members, 'maxAgeMs', 'CacheDirectives'), 'CacheDirectives.maxAgeMs'),
            immutable: IrHydration::boolean(IrHydration::required($members, 'immutable', 'CacheDirectives'), 'CacheDirectives.immutable'),
            noCache: IrHydration::boolean(IrHydration::required($members, 'noCache', 'CacheDirectives'), 'CacheDirectives.noCache'),
            mustRevalidate: IrHydration::boolean(IrHydration::required($members, 'mustRevalidate', 'CacheDirectives'), 'CacheDirectives.mustRevalidate'),
            sharedMaxAgeMs: IrHydration::optional($members, 'sharedMaxAgeMs', static fn (mixed $item): int => IrHydration::integer($item, 'CacheDirectives.sharedMaxAgeMs')),
            staleWhileRevalidateMs: IrHydration::optional($members, 'staleWhileRevalidateMs', static fn (mixed $item): int => IrHydration::integer($item, 'CacheDirectives.staleWhileRevalidateMs')),
            staleIfErrorMs: IrHydration::optional($members, 'staleIfErrorMs', static fn (mixed $item): int => IrHydration::integer($item, 'CacheDirectives.staleIfErrorMs')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'maxAgeMs'} = $this->maxAgeMs;
        if ($this->sharedMaxAgeMs !== null) {
            $json->{'sharedMaxAgeMs'} = $this->sharedMaxAgeMs;
        }
        if ($this->staleWhileRevalidateMs !== null) {
            $json->{'staleWhileRevalidateMs'} = $this->staleWhileRevalidateMs;
        }
        if ($this->staleIfErrorMs !== null) {
            $json->{'staleIfErrorMs'} = $this->staleIfErrorMs;
        }
        $json->{'immutable'} = $this->immutable;
        $json->{'noCache'} = $this->noCache;
        $json->{'mustRevalidate'} = $this->mustRevalidate;
        return $json;
    }
}
