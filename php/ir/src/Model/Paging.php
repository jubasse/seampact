<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The paging of a list; 'style' is absent for an unpaged list. */
final readonly class Paging
{
    /**
     * @param OverLimitPolicy $overLimit
     * @param list<SortKey> $sortKeys
     * @param Origin $origin
     * @param string|null $style
     * @param int|null $maxLimit
     * @param int|null $defaultLimit
     * @param PagingToken|null $token
     */
    public function __construct(
        public OverLimitPolicy $overLimit,
        public array $sortKeys,
        public Origin $origin,
        public ?string $style = null,
        public ?int $maxLimit = null,
        public ?int $defaultLimit = null,
        public ?PagingToken $token = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Paging');

        return new self(
            overLimit: OverLimitPolicy::fromJson(IrHydration::required($members, 'overLimit', 'Paging')),
            sortKeys: IrHydration::listOf(IrHydration::required($members, 'sortKeys', 'Paging'), 'Paging.sortKeys', static fn (mixed $item): SortKey => SortKey::fromJson($item)),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Paging')),
            style: IrHydration::optional($members, 'style', static fn (mixed $item): string => IrHydration::string($item, 'Paging.style')),
            maxLimit: IrHydration::optional($members, 'maxLimit', static fn (mixed $item): int => IrHydration::integer($item, 'Paging.maxLimit')),
            defaultLimit: IrHydration::optional($members, 'defaultLimit', static fn (mixed $item): int => IrHydration::integer($item, 'Paging.defaultLimit')),
            token: IrHydration::optional($members, 'token', static fn (mixed $item): PagingToken => PagingToken::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        if ($this->style !== null) {
            $json->{'style'} = $this->style;
        }
        if ($this->maxLimit !== null) {
            $json->{'maxLimit'} = $this->maxLimit;
        }
        if ($this->defaultLimit !== null) {
            $json->{'defaultLimit'} = $this->defaultLimit;
        }
        $json->{'overLimit'} = $this->overLimit->toJson();
        if ($this->token !== null) {
            $json->{'token'} = $this->token->toJson();
        }
        $json->{'sortKeys'} = IrHydration::encodeList($this->sortKeys, static fn (SortKey $item): mixed => $item->toJson());
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
