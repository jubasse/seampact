<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** What a response header carries: an identity header's semantic (declarations HeaderSemantic) or a deprecation header (ADR 0004 section 7). */
final readonly class ResponseHeaderSemantic
{
    public const Deadline = 'deadline';
    public const TraceContext = 'traceContext';
    public const ActorSurface = 'actorSurface';
    public const VersionToken = 'versionToken';
    public const Deprecation = 'deprecation';
    public const Sunset = 'sunset';
    public const SuccessorLink = 'successorLink';

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
        return [self::Deadline, self::TraceContext, self::ActorSurface, self::VersionToken, self::Deprecation, self::Sunset, self::SuccessorLink];
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
        return new self(IrHydration::string($value, 'ResponseHeaderSemantic'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
