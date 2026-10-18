<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Where an element was declared: a JSON Pointer into the merged authoring tree of its layer (ADR 0004 section 6). */
final readonly class Origin
{
    /**
     * @param string $layer 'api', 'shared', 'base', 'pack:<name>', 'core' for a declaration the compiler supplies (its pointer starts with its entry of formats, errors or schemas, with no side-table entry), or 'workspace' for a diagnostic on workspace.yaml (no IR element carries it). Closed: the one exception to open enums (ADR 0004 section 13).
     * @param string $pointer
     * @param string|null $api Set on an element copied from another api by a relay route.
     */
    public function __construct(
        public string $layer,
        public string $pointer,
        public ?string $api = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Origin');

        return new self(
            layer: IrHydration::string(IrHydration::required($members, 'layer', 'Origin'), 'Origin.layer'),
            pointer: IrHydration::string(IrHydration::required($members, 'pointer', 'Origin'), 'Origin.pointer'),
            api: IrHydration::optional($members, 'api', static fn (mixed $item): string => IrHydration::string($item, 'Origin.api')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        if ($this->api !== null) {
            $json->{'api'} = $this->api;
        }
        $json->{'layer'} = $this->layer;
        $json->{'pointer'} = $this->pointer;
        return $json;
    }
}
