<?php

declare(strict_types=1);

namespace Seampact\Symfony\Shared;

/** The shared names of one operation the Symfony placement reads, each class fully qualified. */
final readonly class OperationTypeNames
{
    public function __construct(
        public string $method,
        public string $input,
        public string $result,
        public string $endpoints,
    ) {
    }
}
