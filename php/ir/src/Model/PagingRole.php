<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The role of a paging request parameter. */
final readonly class PagingRole
{
    public const Cursor = 'cursor';
    public const After = 'after';
    public const Before = 'before';
    public const Page = 'page';
    public const Offset = 'offset';
    public const Since = 'since';
    public const Limit = 'limit';
    public const Sort = 'sort';

    private function __construct(public string $value)
    {
    }

    /**
     * The values this IR revision knows, in the schema's order.
     *
     * @return list<string>
     */
    public static function known(): array
    {
        return [self::Cursor, self::After, self::Before, self::Page, self::Offset, self::Since, self::Limit, self::Sort];
    }

    /** A value this IR revision does not know is kept; `isKnown()` tells it apart. */
    public static function of(string $value): self
    {
        return new self($value);
    }

    public function isKnown(): bool
    {
        return in_array($this->value, self::known(), true);
    }

    public static function fromJson(mixed $value): self
    {
        return new self(IrHydration::string($value, 'PagingRole'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
