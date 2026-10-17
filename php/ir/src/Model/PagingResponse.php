<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class PagingResponse
{
    /**
     * @param list<NamedTemplate> $meta
     * @param list<HeaderTemplate> $headers
     * @param list<PagingLink> $links
     * @param Template|null $body The whole page body; absent when the style adds 'meta' to the format's page.
     */
    public function __construct(
        public array $meta,
        public array $headers,
        public array $links,
        public ?Template $body = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'PagingResponse');

        return new self(
            meta: IrHydration::listOf(IrHydration::required($members, 'meta', 'PagingResponse'), 'PagingResponse.meta', static fn (mixed $item): NamedTemplate => NamedTemplate::fromJson($item)),
            headers: IrHydration::listOf(IrHydration::required($members, 'headers', 'PagingResponse'), 'PagingResponse.headers', static fn (mixed $item): HeaderTemplate => HeaderTemplate::fromJson($item)),
            links: IrHydration::listOf(IrHydration::required($members, 'links', 'PagingResponse'), 'PagingResponse.links', static fn (mixed $item): PagingLink => PagingLink::fromJson($item)),
            body: IrHydration::optional($members, 'body', static fn (mixed $item): Template => Template::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        if ($this->body !== null) {
            $json->{'body'} = $this->body->toJson();
        }
        $json->{'meta'} = IrHydration::encodeList($this->meta, static fn (NamedTemplate $item): mixed => $item->toJson());
        $json->{'headers'} = IrHydration::encodeList($this->headers, static fn (HeaderTemplate $item): mixed => $item->toJson());
        $json->{'links'} = IrHydration::encodeList($this->links, static fn (PagingLink $item): mixed => $item->toJson());
        return $json;
    }
}
