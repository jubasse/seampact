<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** The framework-neutral PHP names of one operation: its handler method and the classes every PHP target writes for it. */
final readonly class OperationNames
{
    /** @param array<int, string> $responses each declared success status and its result class */
    public function __construct(
        public string $method,
        public string $input,
        public string $path,
        public string $query,
        public string $headers,
        public string $result,
        public string $errors,
        public string $endpoints,
        public array $responses,
    ) {
    }
}
