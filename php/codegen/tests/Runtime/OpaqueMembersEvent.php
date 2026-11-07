<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

/** A generated schema class with two opaque members: `payload` is nullable, `meta` is required and not nullable. */
final class OpaqueMembersEvent
{
    public function __construct(
        public readonly mixed $payload,
        public readonly mixed $meta,
    ) {
    }
}
