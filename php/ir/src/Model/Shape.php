<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Shape
{
    /**
     * @param Template $body
     * @param list<HeaderTemplate> $headers
     */
    public function __construct(
        public Template $body,
        public array $headers,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Shape');

        return new self(
            body: Template::fromJson(IrHydration::required($members, 'body', 'Shape')),
            headers: IrHydration::listOf(IrHydration::required($members, 'headers', 'Shape'), 'Shape.headers', static fn (mixed $item): HeaderTemplate => HeaderTemplate::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'body'} = $this->body->toJson();
        $json->{'headers'} = IrHydration::encodeList($this->headers, static fn (HeaderTemplate $item): mixed => $item->toJson());
        return $json;
    }
}
