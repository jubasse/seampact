<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The media type of a request body. */
final readonly class InputMediaType
{
    public const ApplicationJson = 'application/json';
    public const ApplicationXWwwFormUrlencoded = 'application/x-www-form-urlencoded';
    public const MultipartFormData = 'multipart/form-data';

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
        return [self::ApplicationJson, self::ApplicationXWwwFormUrlencoded, self::MultipartFormData];
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
        return new self(IrHydration::string($value, 'InputMediaType'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
