<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A role of ADR 0006 section 6. */
final readonly class ErrorRole
{
    public const SchemaInvalid = 'schemaInvalid';
    public const PayloadTooLarge = 'payloadTooLarge';
    public const UnsupportedMediaType = 'unsupportedMediaType';
    public const Unauthenticated = 'unauthenticated';
    public const CsrfInvalid = 'csrfInvalid';
    public const IdempotencyKeyReused = 'idempotencyKeyReused';
    public const IdempotencyInProgress = 'idempotencyInProgress';
    public const StateConflict = 'stateConflict';
    public const PreconditionFailed = 'preconditionFailed';
    public const PreconditionRequired = 'preconditionRequired';
    public const NotFound = 'notFound';
    public const Forbidden = 'forbidden';
    public const SortKeyForbidden = 'sortKeyForbidden';
    public const RateLimited = 'rateLimited';
    public const DeadlineExceeded = 'deadlineExceeded';
    public const Gone = 'gone';
    public const UpstreamUnavailable = 'upstreamUnavailable';
    public const ServiceUnavailable = 'serviceUnavailable';
    public const UpstreamTimeout = 'upstreamTimeout';
    public const UndeclaredStatus = 'undeclaredStatus';

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
        return [self::SchemaInvalid, self::PayloadTooLarge, self::UnsupportedMediaType, self::Unauthenticated, self::CsrfInvalid, self::IdempotencyKeyReused, self::IdempotencyInProgress, self::StateConflict, self::PreconditionFailed, self::PreconditionRequired, self::NotFound, self::Forbidden, self::SortKeyForbidden, self::RateLimited, self::DeadlineExceeded, self::Gone, self::UpstreamUnavailable, self::ServiceUnavailable, self::UpstreamTimeout, self::UndeclaredStatus];
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
        return new self(IrHydration::string($value, 'ErrorRole'));
    }

    public function toJson(): string
    {
        return $this->value;
    }
}
