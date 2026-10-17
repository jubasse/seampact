<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class SuccessShapes
{
    /**
     * @param Shape $item
     * @param Shape $table
     * @param Shape $list
     * @param Shape $page
     */
    public function __construct(
        public Shape $item,
        public Shape $table,
        public Shape $list,
        public Shape $page,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SuccessShapes');

        return new self(
            item: Shape::fromJson(IrHydration::required($members, 'item', 'SuccessShapes')),
            table: Shape::fromJson(IrHydration::required($members, 'table', 'SuccessShapes')),
            list: Shape::fromJson(IrHydration::required($members, 'list', 'SuccessShapes')),
            page: Shape::fromJson(IrHydration::required($members, 'page', 'SuccessShapes')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'item'} = $this->item->toJson();
        $json->{'table'} = $this->table->toJson();
        $json->{'list'} = $this->list->toJson();
        $json->{'page'} = $this->page->toJson();
        return $json;
    }
}
