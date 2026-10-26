<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Symfony\Component\Validator\Constraint;

/**
 * What the contract says of one input member: its presence, nullability and JSON type, the value checks the target
 * generates, the Symfony constraints it renders under `rules: native` (each carrying its contract rule in its
 * `payload`), and, for an object or a list, the members or the item it holds.
 */
final readonly class Member
{
    /**
     * @param list<Constraint> $native
     * @param array<string, Member> $properties
     */
    public function __construct(
        public JsonType $type,
        public Presence $presence = Presence::Required,
        public Nullability $nullability = Nullability::NotNull,
        public Checks $checks = new Checks(),
        public array $native = [],
        public array $properties = [],
        public KeyPolicy $unknownKeys = KeyPolicy::Refuse,
        public ?Member $items = null,
    ) {
    }
}
