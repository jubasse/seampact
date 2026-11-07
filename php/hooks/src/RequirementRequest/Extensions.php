<?php

declare(strict_types=1);

namespace Seampact\Hooks\RequirementRequest;

/** The extension values a decider receives: the right's or rule's, and the operation's. */
final readonly class Extensions
{
    public function __construct(
        public object $requirement,
        public object $operation,
    ) {
    }
}
