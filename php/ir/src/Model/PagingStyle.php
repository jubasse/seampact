<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A paging style (A31). */
final readonly class PagingStyle
{
    /**
     * @param string $id
     * @param Origin $origin
     * @param PagingPosition $position
     * @param Absent $absent
     * @param list<PagingRequestRole> $request
     * @param PagingResponse $response
     * @param list<HandlerResultMember> $handlerResult
     */
    public function __construct(
        public string $id,
        public Origin $origin,
        public PagingPosition $position,
        public Absent $absent,
        public array $request,
        public PagingResponse $response,
        public array $handlerResult,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'PagingStyle');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'PagingStyle'), 'PagingStyle.id'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'PagingStyle')),
            position: PagingPosition::fromJson(IrHydration::required($members, 'position', 'PagingStyle')),
            absent: Absent::fromJson(IrHydration::required($members, 'absent', 'PagingStyle')),
            request: IrHydration::listOf(IrHydration::required($members, 'request', 'PagingStyle'), 'PagingStyle.request', static fn (mixed $item): PagingRequestRole => PagingRequestRole::fromJson($item)),
            response: PagingResponse::fromJson(IrHydration::required($members, 'response', 'PagingStyle')),
            handlerResult: IrHydration::listOf(IrHydration::required($members, 'handlerResult', 'PagingStyle'), 'PagingStyle.handlerResult', static fn (mixed $item): HandlerResultMember => HandlerResultMember::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'origin'} = $this->origin->toJson();
        $json->{'position'} = $this->position->toJson();
        $json->{'absent'} = $this->absent->toJson();
        $json->{'request'} = IrHydration::encodeList($this->request, static fn (PagingRequestRole $item): mixed => $item->toJson());
        $json->{'response'} = $this->response->toJson();
        $json->{'handlerResult'} = IrHydration::encodeList($this->handlerResult, static fn (HandlerResultMember $item): mixed => $item->toJson());
        return $json;
    }
}
