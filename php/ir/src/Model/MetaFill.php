<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Who fills a $meta member; 'source' reads the member 'source'. */
final readonly class MetaFill
{
    public const Now = 'now';
    public const TraceId = 'traceId';
    public const Degraded = 'degraded';
    public const Handler = 'handler';
    public const Source = 'source';

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
        return [self::Now, self::TraceId, self::Degraded, self::Handler, self::Source];
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
        return new self(IrHydration::string($value, 'MetaFill'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
