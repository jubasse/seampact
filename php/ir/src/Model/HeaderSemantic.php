<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** What an identity header carries (ADR 0002 section 9). */
final readonly class HeaderSemantic
{
    public const Deadline = 'deadline';
    public const TraceContext = 'traceContext';
    public const ActorSurface = 'actorSurface';
    public const VersionToken = 'versionToken';

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
        return [self::Deadline, self::TraceContext, self::ActorSurface, self::VersionToken];
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
        return new self(IrHydration::string($value, 'HeaderSemantic'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
