<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ErrorShape
{
    /**
     * @param string $media
     * @param Template $body
     * @param list<HeaderTemplate> $headers
     */
    public function __construct(
        public string $media,
        public Template $body,
        public array $headers,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ErrorShape');

        return new self(
            media: IrHydration::string(IrHydration::required($members, 'media', 'ErrorShape'), 'ErrorShape.media'),
            body: Template::fromJson(IrHydration::required($members, 'body', 'ErrorShape')),
            headers: IrHydration::listOf(IrHydration::required($members, 'headers', 'ErrorShape'), 'ErrorShape.headers', static fn (mixed $item): HeaderTemplate => HeaderTemplate::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'media'} = $this->media;
        $json->{'body'} = $this->body->toJson();
        $json->{'headers'} = IrHydration::encodeList($this->headers, static fn (HeaderTemplate $item): mixed => $item->toJson());
        return $json;
    }
}
