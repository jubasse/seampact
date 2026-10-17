<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A success or derived non-error response. */
final readonly class Response
{
    /**
     * @param int $status
     * @param ResponseShape $shape
     * @param list<ResponseHeader> $headers
     * @param string|null $media Absent for an empty body.
     * @param TypeUse|null $body
     * @param Origin|null $origin
     * @param DerivedFrom|null $derivedFrom
     */
    public function __construct(
        public int $status,
        public ResponseShape $shape,
        public array $headers,
        public ?string $media = null,
        public ?TypeUse $body = null,
        public ?Origin $origin = null,
        public ?DerivedFrom $derivedFrom = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Response');

        return new self(
            status: IrHydration::integer(IrHydration::required($members, 'status', 'Response'), 'Response.status'),
            shape: ResponseShape::fromJson(IrHydration::required($members, 'shape', 'Response')),
            headers: IrHydration::listOf(IrHydration::required($members, 'headers', 'Response'), 'Response.headers', static fn (mixed $item): ResponseHeader => ResponseHeader::fromJson($item)),
            media: IrHydration::optional($members, 'media', static fn (mixed $item): string => IrHydration::string($item, 'Response.media')),
            body: IrHydration::optional($members, 'body', static fn (mixed $item): TypeUse => TypeUse::fromJson($item)),
            origin: IrHydration::optional($members, 'origin', static fn (mixed $item): Origin => Origin::fromJson($item)),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'status'} = $this->status;
        if ($this->media !== null) {
            $json->{'media'} = $this->media;
        }
        if ($this->body !== null) {
            $json->{'body'} = $this->body->toJson();
        }
        $json->{'shape'} = $this->shape->toJson();
        $json->{'headers'} = IrHydration::encodeList($this->headers, static fn (ResponseHeader $item): mixed => $item->toJson());
        if ($this->origin !== null) {
            $json->{'origin'} = $this->origin->toJson();
        }
        if ($this->derivedFrom !== null) {
            $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        }
        return $json;
    }
}
