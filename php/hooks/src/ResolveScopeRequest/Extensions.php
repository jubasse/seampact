<?php

declare(strict_types=1);

namespace Seampact\Hooks\ResolveScopeRequest;

/** The extension values a scope resolver receives: the scope's, and the operation's. */
final readonly class Extensions
{
    public function __construct(
        public object $scope,
        public object $operation,
    ) {
    }
}
