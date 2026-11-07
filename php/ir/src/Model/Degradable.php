<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Degradable
{
    /**
     * @param list<string> $paths
     * @param Origin $origin
     * @param string|null $header The header listing degraded parts, an RFC 9110 token; required when the operation's format has no 'degraded' meta member (invariant ir.degradable.header).
     */
    public function __construct(
        public array $paths,
        public Origin $origin,
        public ?string $header = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Degradable');

        return new self(
            paths: IrHydration::listOf(IrHydration::required($members, 'paths', 'Degradable'), 'Degradable.paths', static fn (mixed $item): string => IrHydration::string($item, 'Degradable.paths[]')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Degradable')),
            header: IrHydration::optional($members, 'header', static fn (mixed $item): string => IrHydration::string($item, 'Degradable.header')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'paths'} = $this->paths;
        if ($this->header !== null) {
            $json->{'header'} = $this->header;
        }
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
