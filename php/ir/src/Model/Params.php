<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Params
{
    /**
     * @param list<Param> $path
     * @param list<Param> $query
     * @param list<Param> $header
     */
    public function __construct(
        public array $path,
        public array $query,
        public array $header,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Params');

        return new self(
            path: IrHydration::listOf(IrHydration::required($members, 'path', 'Params'), 'Params.path', static fn (mixed $item): Param => Param::fromJson($item)),
            query: IrHydration::listOf(IrHydration::required($members, 'query', 'Params'), 'Params.query', static fn (mixed $item): Param => Param::fromJson($item)),
            header: IrHydration::listOf(IrHydration::required($members, 'header', 'Params'), 'Params.header', static fn (mixed $item): Param => Param::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'path'} = IrHydration::encodeList($this->path, static fn (Param $item): mixed => $item->toJson());
        $json->{'query'} = IrHydration::encodeList($this->query, static fn (Param $item): mixed => $item->toJson());
        $json->{'header'} = IrHydration::encodeList($this->header, static fn (Param $item): mixed => $item->toJson());
        return $json;
    }
}
