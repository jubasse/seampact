<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The refinements of a scalar (ADR 0003 sections 1 and 8); numeric ones are decimal literal strings, compared numerically. */
final readonly class Refinements
{
    /**
     * @param int|null $minLength
     * @param int|null $maxLength
     * @param Pattern|null $pattern
     * @param string|null $minimum
     * @param string|null $maximum
     * @param string|null $exclusiveMinimum
     * @param string|null $exclusiveMaximum
     * @param string|null $multipleOf
     */
    public function __construct(
        public ?int $minLength = null,
        public ?int $maxLength = null,
        public ?Pattern $pattern = null,
        public ?string $minimum = null,
        public ?string $maximum = null,
        public ?string $exclusiveMinimum = null,
        public ?string $exclusiveMaximum = null,
        public ?string $multipleOf = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Refinements');

        return new self(
            minLength: IrHydration::optional($members, 'minLength', static fn (mixed $item): int => IrHydration::integer($item, 'Refinements.minLength')),
            maxLength: IrHydration::optional($members, 'maxLength', static fn (mixed $item): int => IrHydration::integer($item, 'Refinements.maxLength')),
            pattern: IrHydration::optional($members, 'pattern', static fn (mixed $item): Pattern => Pattern::fromJson($item)),
            minimum: IrHydration::optional($members, 'minimum', static fn (mixed $item): string => IrHydration::string($item, 'Refinements.minimum')),
            maximum: IrHydration::optional($members, 'maximum', static fn (mixed $item): string => IrHydration::string($item, 'Refinements.maximum')),
            exclusiveMinimum: IrHydration::optional($members, 'exclusiveMinimum', static fn (mixed $item): string => IrHydration::string($item, 'Refinements.exclusiveMinimum')),
            exclusiveMaximum: IrHydration::optional($members, 'exclusiveMaximum', static fn (mixed $item): string => IrHydration::string($item, 'Refinements.exclusiveMaximum')),
            multipleOf: IrHydration::optional($members, 'multipleOf', static fn (mixed $item): string => IrHydration::string($item, 'Refinements.multipleOf')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        if ($this->minLength !== null) {
            $json->{'minLength'} = $this->minLength;
        }
        if ($this->maxLength !== null) {
            $json->{'maxLength'} = $this->maxLength;
        }
        if ($this->pattern !== null) {
            $json->{'pattern'} = $this->pattern->toJson();
        }
        if ($this->minimum !== null) {
            $json->{'minimum'} = $this->minimum;
        }
        if ($this->maximum !== null) {
            $json->{'maximum'} = $this->maximum;
        }
        if ($this->exclusiveMinimum !== null) {
            $json->{'exclusiveMinimum'} = $this->exclusiveMinimum;
        }
        if ($this->exclusiveMaximum !== null) {
            $json->{'exclusiveMaximum'} = $this->exclusiveMaximum;
        }
        if ($this->multipleOf !== null) {
            $json->{'multipleOf'} = $this->multipleOf;
        }
        return $json;
    }
}
