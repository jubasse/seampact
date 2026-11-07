<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** A resolved scope: its name, its id, and the value the resolver loaded, when it loaded one. */
final readonly class ResolvedScope
{
    public function __construct(
        public string $scope,
        public int|string|object $id,
        public mixed $value = null,
    ) {
    }
}
