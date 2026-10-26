<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/** One failure answered with the api's 500: the operation, a reason without input values, and the exception. */
final readonly class UnexpectedFailure
{
    public function __construct(
        public string $api,
        public ?string $operation,
        public string $reason,
        public ?\Throwable $cause = null,
    ) {
    }
}
