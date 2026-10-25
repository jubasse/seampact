<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/**
 * A property that is both optional and nullable (ADR 0003 section 5): absent, null, or a value, three distinct
 * states, so `{}` and `{"publishOn": null}` reach the handler apart.
 *
 * @template-covariant T = never
 */
final class Field
{
    private const STATE_ABSENT = 'absent';
    private const STATE_NULL = 'null';
    private const STATE_PRESENT = 'present';

    /** @param T|null $value */
    private function __construct(
        private readonly string $state,
        private readonly mixed $value,
    ) {
    }

    /**
     * The property is not in the payload.
     *
     * @return self<never>
     */
    public static function absent(): self
    {
        return new self(self::STATE_ABSENT, null);
    }

    /**
     * The property is in the payload as null.
     *
     * @return self<never>
     */
    public static function ofNull(): self
    {
        return new self(self::STATE_NULL, null);
    }

    /**
     * The property holds a value; a null value is refused, since ofNull() says it.
     *
     * @template TValue
     *
     * @param TValue $value
     *
     * @return self<TValue>
     */
    public static function of(mixed $value): self
    {
        if ($value === null) {
            throw new \InvalidArgumentException('Field::of() takes a value; use Field::ofNull() for null.');
        }

        return new self(self::STATE_PRESENT, $value);
    }

    public function isAbsent(): bool
    {
        return $this->state === self::STATE_ABSENT;
    }

    public function isNull(): bool
    {
        return $this->state === self::STATE_NULL;
    }

    public function isPresent(): bool
    {
        return $this->state === self::STATE_PRESENT;
    }

    /**
     * The value, when present.
     *
     * @return T
     */
    public function value(): mixed
    {
        if ($this->state !== self::STATE_PRESENT) {
            throw new \LogicException("The field is {$this->state}; check isPresent() first.");
        }

        /** @var T */
        return $this->value;
    }
}
