<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class PathApiVersion extends ApiVersion
{
    /** The tag member 'kind': fixed to 'path'. */
    public string $kind;

    /**
     * @param int $number The number paths carry ('/v1').
     */
    public function __construct(
        public int $number,
    ) {
        $this->kind = 'path';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'PathApiVersion');
        IrHydration::tag($members, 'kind', 'path', 'PathApiVersion');

        return new self(
            number: IrHydration::integer(IrHydration::required($members, 'number', 'PathApiVersion'), 'PathApiVersion.number'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'number'} = $this->number;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
