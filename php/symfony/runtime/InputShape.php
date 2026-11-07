<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

/**
 * The members of one operation's input, per part: path, query and header parameters by wire name, and the body, whose
 * top level also takes the fields its rules read their proofs from (ADR 0012 step 7), which the access steps check.
 */
final readonly class InputShape
{
    /**
     * @param array<string, Member> $path
     * @param array<string, Member> $query
     * @param array<string, Member> $header
     * @param list<string> $bodyProofs
     */
    public function __construct(
        public array $path = [],
        public array $query = [],
        public array $header = [],
        public KeyPolicy $unknownQuery = KeyPolicy::Keep,
        public ?Member $body = null,
        public array $bodyProofs = [],
    ) {
    }
}
