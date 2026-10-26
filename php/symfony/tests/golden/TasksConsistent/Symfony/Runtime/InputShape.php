<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/** The members of one operation's input, per part: path, query and header parameters by wire name, and the body. */
final readonly class InputShape
{
    /**
     * @param array<string, Member> $path
     * @param array<string, Member> $query
     * @param array<string, Member> $header
     */
    public function __construct(
        public array $path = [],
        public array $query = [],
        public array $header = [],
        public KeyPolicy $unknownQuery = KeyPolicy::Keep,
        public ?Member $body = null,
    ) {
    }
}
